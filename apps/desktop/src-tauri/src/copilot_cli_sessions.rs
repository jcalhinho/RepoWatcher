//! Reads only appended GitHub Copilot CLI session events
//! (`~/.copilot/session-state/<session>/events.jsonl`) and projects safe operational metadata
//! into the shared event stream. Historical sessions are never backfilled; assistant text,
//! reasoning, tool arguments other than the target path and tool outputs are never persisted.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration as StdDuration, SystemTime},
};

const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
const POLL_INTERVAL: StdDuration = StdDuration::from_millis(1000);
const ACTIVE_FILE_WINDOW: Duration = Duration::hours(48);
const EVENTS_FILE: &str = "events.jsonl";

type ActiveTool = (String, Option<String>, Option<String>);

#[derive(Default)]
struct SessionContext {
    id: String,
    project_path: Option<String>,
    model: Option<String>,
    started: bool,
    active_tools: HashMap<String, ActiveTool>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
}

pub struct CopilotMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl CopilotMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for (path, length) in recent_event_files(&self.root) {
            if !self.cursors.contains_key(&path) {
                let created_before_start = fs::metadata(&path)
                    .and_then(|metadata| metadata.created())
                    .map(|created| created < self.started_at)
                    .unwrap_or(true);
                self.cursors.insert(
                    path.clone(),
                    Cursor {
                        offset: if created_before_start { length } else { 0 },
                        pending: Vec::new(),
                        context: fresh_context(&path, created_before_start),
                    },
                );
            }
            // Unchanged files are skipped without opening them (costly on Windows: antivirus filters).
            if let Some(cursor) = self
                .cursors
                .get_mut(&path)
                .filter(|cursor| cursor.offset != length)
            {
                events.extend(read_appended_records(
                    &path,
                    cursor,
                    capture_prompts,
                    capture_commands,
                ));
            }
        }
        events
    }
}

/// `%USERPROFILE%\.copilot\session-state` on Windows, `$HOME/.copilot/session-state` elsewhere.
pub fn sessions_root() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".copilot")
        .join("session-state")
}

pub fn spawn<F>(
    root: PathBuf,
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
    mut on_event: F,
) where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = CopilotMonitor::new(root);
        loop {
            let events = monitor.poll(
                capture_prompts.load(Ordering::Relaxed),
                capture_commands.load(Ordering::Relaxed),
            );
            for event in events {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

/// Event logs live exactly at `<root>/<session>/events.jsonl`.
fn recent_event_files(root: &Path) -> Vec<(PathBuf, u64)> {
    let cutoff = Utc::now() - ACTIVE_FILE_WINDOW;
    let mut files = Vec::new();
    let Ok(sessions) = fs::read_dir(root) else {
        return files;
    };
    for session in sessions.flatten() {
        let path = session.path().join(EVENTS_FILE);
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if metadata.is_file() && DateTime::<Utc>::from(modified) >= cutoff {
            files.push((path, metadata.len()));
        }
    }
    files
}

fn session_id_from_path(path: &Path) -> String {
    path.parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or("copilot-session")
        .to_owned()
}

/// A session already running at startup has no observable `session.start`, so its working folder
/// comes from the `workspace.yaml` Copilot CLI keeps beside the log.
fn fresh_context(path: &Path, started: bool) -> SessionContext {
    let project_path = fs::read_to_string(path.with_file_name("workspace.yaml"))
        .ok()
        .and_then(|text| {
            text.lines()
                .find_map(|line| line.strip_prefix("cwd:"))
                .map(|value| value.trim().trim_matches(['"', '\'']).to_owned())
        })
        .filter(|value| !value.is_empty());
    SessionContext {
        id: session_id_from_path(path),
        project_path,
        started,
        ..SessionContext::default()
    }
}

fn read_appended_records(
    path: &Path,
    cursor: &mut Cursor,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let Ok(mut file) = fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(metadata) = file.metadata() else {
        return Vec::new();
    };
    if metadata.len() < cursor.offset {
        cursor.offset = 0;
        cursor.pending.clear();
        cursor.context = fresh_context(path, false);
    }
    if metadata.len() == cursor.offset || file.seek(SeekFrom::Start(cursor.offset)).is_err() {
        return Vec::new();
    }
    let mut appended = Vec::new();
    if file
        .take(8 * 1024 * 1024)
        .read_to_end(&mut appended)
        .is_err()
    {
        return Vec::new();
    }
    cursor.offset += appended.len() as u64;
    cursor.pending.extend(appended);
    let mut events = Vec::new();
    while let Some(newline) = cursor.pending.iter().position(|byte| *byte == b'\n') {
        if newline <= MAX_LINE_BYTES
            && let Ok(record) = serde_json::from_slice::<Value>(&cursor.pending[..newline])
        {
            events.extend(project_record(
                &record,
                &mut cursor.context,
                capture_prompts,
                capture_commands,
            ));
        }
        cursor.pending.drain(..=newline);
    }
    if cursor.pending.len() > MAX_LINE_BYTES {
        cursor.pending.clear();
    }
    events
}

// shortcut: Copilot CLI logs no explicit "waiting for you" marker, so the end of a turn is its
// `agentStop` hook record; if a future version drops it, turns just stay "working" until idle.
fn project_record(
    record: &Value,
    context: &mut SessionContext,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let occurred_at = record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|timestamp| DateTime::parse_from_rfc3339(timestamp).ok())
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let at = |mut event: SessionEvent| {
        event.occurred_at = occurred_at;
        event
    };
    let data = record.get("data");
    let text = |key: &str| data.and_then(|data| data.get(key)).and_then(Value::as_str);

    match record.get("type").and_then(Value::as_str) {
        Some("session.start") => {
            if let Some(cwd) = data
                .and_then(|data| data.get("context"))
                .and_then(|value| value.get("cwd"))
                .and_then(Value::as_str)
            {
                context.project_path = Some(cwd.to_owned());
            }
            context.started = true;
            vec![at(event(context, EventKind::SessionStarted))]
        }
        Some("user.message") => {
            let mut prompt = at(event(context, EventKind::UserMessage));
            if capture_prompts {
                prompt.content = text("content").map(str::to_owned);
            }
            vec![prompt]
        }
        Some("tool.execution_start") => {
            let (Some(id), Some(name)) = (text("toolCallId"), text("toolName")) else {
                return Vec::new();
            };
            let args = data.and_then(|data| data.get("arguments"));
            let file_path = text_field(args, "path");
            let command = capture_commands
                .then(|| text_field(args, "command"))
                .flatten();
            context.active_tools.insert(
                id.to_owned(),
                (name.to_owned(), file_path.clone(), command.clone()),
            );
            let mut started = at(event(context, EventKind::ToolStarted));
            started.tool_name = Some(name.to_owned());
            started.file_path = file_path;
            started.command = command;
            vec![started]
        }
        Some("tool.execution_complete") => {
            let Some(id) = text("toolCallId") else {
                return Vec::new();
            };
            let (name, file_path, command) = context
                .active_tools
                .remove(id)
                .unwrap_or_else(|| ("tool".to_owned(), None, None));
            let failed = data
                .and_then(|data| data.get("success"))
                .and_then(Value::as_bool)
                == Some(false);
            let mut finished = at(event(
                context,
                if failed {
                    EventKind::ToolFailed
                } else {
                    EventKind::ToolFinished
                },
            ));
            finished.tool_name = Some(name);
            finished.file_path = file_path;
            finished.command = command;
            finished.outcome = failed.then(|| "error".to_owned());
            vec![finished]
        }
        Some("session.usage_record") => {
            let Some(usage) = data.and_then(|data| data.get("usage")) else {
                return Vec::new();
            };
            let number = |key: &str| usage.get(key).and_then(Value::as_u64);
            if let Some(model) = usage.get("model").and_then(Value::as_str) {
                context.model = Some(model.to_owned());
            }
            let (read, write) = (number("cacheReadTokens"), number("cacheWriteTokens"));
            let mut model = at(event(context, EventKind::ModelUsage));
            // `inputTokens` is the whole prompt, cache reads and writes included; the session
            // totals Copilot CLI reports at shutdown confirm that uncached = input - read - write.
            model.input_tokens = number("inputTokens").map(|input| Sourced {
                value: input
                    .saturating_sub(read.unwrap_or(0))
                    .saturating_sub(write.unwrap_or(0)),
                origin: if read.is_some() || write.is_some() {
                    DataOrigin::Derived
                } else {
                    DataOrigin::Provider
                },
            });
            model.cache_read_tokens = read.map(provider_value);
            model.cache_write_tokens = write.map(provider_value);
            model.output_tokens = number("outputTokens").map(provider_value);
            model.duration_ms = number("duration").map(provider_value);
            if model.input_tokens.is_some() || model.output_tokens.is_some() {
                vec![model]
            } else {
                Vec::new()
            }
        }
        Some("hook.start") if text("hookType") == Some("agentStop") => {
            let mut checkpoint = at(event(context, EventKind::Checkpoint));
            checkpoint.outcome = Some("turn-completed".to_owned());
            vec![checkpoint]
        }
        Some("session.shutdown") => vec![at(event(context, EventKind::SessionEnded))],
        _ => Vec::new(),
    }
}

fn event(context: &SessionContext, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(&context.id, Provider::GitHubCopilot, kind);
    event.project_path = context.project_path.clone();
    event.model = context.model.as_deref().map(provider_string);
    event
}

fn text_field(value: Option<&Value>, key: &str) -> Option<String> {
    value?.get(key)?.as_str().map(str::to_owned)
}

fn provider_value(value: u64) -> Sourced<u64> {
    Sourced {
        value,
        origin: DataOrigin::Provider,
    }
}

fn provider_string(value: &str) -> Sourced<String> {
    Sourced {
        value: value.to_owned(),
        origin: DataOrigin::Provider,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(kind: &str, data: Value) -> Value {
        json!({ "type": kind, "data": data, "id": "x", "timestamp": "2026-10-24T12:21:37.875Z", "parentId": null })
    }

    fn run(records: &[Value], capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut context = SessionContext {
            id: "s1".into(),
            ..SessionContext::default()
        };
        records
            .iter()
            .flat_map(|record| project_record(record, &mut context, capture_prompts, capture_commands))
            .collect()
    }

    #[test]
    fn session_prompts_and_turn_ends_follow_the_log() {
        let records = [
            record("session.start", json!({ "context": { "cwd": "/work/demo" }, "selectedModel": "auto" })),
            record("user.message", json!({ "content": "private prompt" })),
            record("assistant.message", json!({ "content": "must not be retained", "toolRequests": [] })),
            record("hook.start", json!({ "hookType": "preToolUse" })),
            record("hook.start", json!({ "hookType": "agentStop" })),
            record("session.shutdown", json!({})),
        ];
        let hidden = run(&records, false, false);
        assert_eq!(
            hidden.iter().map(|event| event.kind).collect::<Vec<_>>(),
            [EventKind::SessionStarted, EventKind::UserMessage, EventKind::Checkpoint, EventKind::SessionEnded]
        );
        assert!(hidden.iter().all(|event| event.provider == Provider::GitHubCopilot && event.content.is_none()));
        assert_eq!(hidden[1].project_path.as_deref(), Some("/work/demo"));
        assert_eq!(hidden[2].outcome.as_deref(), Some("turn-completed"));
        assert_eq!(hidden[0].occurred_at.to_rfc3339(), "2026-10-24T12:21:37.875+00:00");
        assert_eq!(run(&records, true, false)[1].content.as_deref(), Some("private prompt"));
    }

    #[test]
    fn tool_lifecycle_keeps_names_and_paths_and_gates_commands() {
        let records = [
            record("tool.execution_start", json!({ "toolCallId": "c1", "toolName": "view", "arguments": { "path": "/work/demo/src/main.rs" } })),
            record("tool.execution_complete", json!({ "toolCallId": "c1", "success": true, "result": { "content": "must not be retained" } })),
            record("tool.execution_start", json!({ "toolCallId": "c2", "toolName": "bash", "arguments": { "command": "rm -rf secret" } })),
            record("tool.execution_complete", json!({ "toolCallId": "c2", "success": false })),
            record("tool.execution_start", json!({ "toolCallId": "c3", "toolName": "apply_patch", "arguments": "*** patch as a string ***" })),
        ];
        let events = run(&records, true, false);
        assert_eq!(events.len(), 5);
        assert_eq!(events[0].tool_name.as_deref(), Some("view"));
        assert_eq!(events[1].kind, EventKind::ToolFinished);
        assert_eq!(events[1].file_path.as_deref(), Some("/work/demo/src/main.rs"));
        assert_eq!(events[3].kind, EventKind::ToolFailed);
        assert_eq!(events[3].tool_name.as_deref(), Some("bash"));
        assert_eq!(events[3].outcome.as_deref(), Some("error"));
        assert!(events.iter().all(|event| event.command.is_none() && event.content.is_none()));
        assert_eq!(events[4].file_path, None);
        let captured = run(&records, false, true);
        assert_eq!(captured[2].command.as_deref(), Some("rm -rf secret"));
    }

    #[test]
    fn usage_separates_cached_tokens_from_the_whole_prompt() {
        let events = run(
            &[
                record("session.usage_record", json!({ "usage": { "model": "gpt-6-luna", "inputTokens": 20237,
                    "cacheReadTokens": 18690, "cacheWriteTokens": 1544, "outputTokens": 415, "duration": 6014, "cost": 1.0 } })),
                record("session.usage_record", json!({ "usage": { "inputTokens": 100, "outputTokens": 5 } })),
                record("session.usage_record", json!({ "usage": { "model": "m" } })),
            ],
            true,
            true,
        );
        assert_eq!(events.len(), 2);
        let first = &events[0];
        assert_eq!(first.input_tokens.as_ref().map(|value| (value.value, value.origin)), Some((3, DataOrigin::Derived)));
        assert_eq!(first.cache_read_tokens.as_ref().map(|value| value.value), Some(18690));
        assert_eq!(first.cache_write_tokens.as_ref().map(|value| value.value), Some(1544));
        assert_eq!(first.output_tokens.as_ref().map(|value| value.value), Some(415));
        assert_eq!(first.duration_ms.as_ref().map(|value| value.value), Some(6014));
        assert_eq!(first.model.as_ref().map(|value| value.value.as_str()), Some("gpt-6-luna"));
        assert_eq!(events[1].input_tokens.as_ref().map(|value| (value.value, value.origin)), Some((100, DataOrigin::Provider)));
    }

    #[test]
    fn only_appended_lines_are_read_and_the_working_folder_comes_from_workspace_yaml() {
        let root = env::temp_dir().join(format!("agent-observer-copilot-{}", uuid::Uuid::new_v4()));
        let session = root.join("0b3e6589-demo");
        fs::create_dir_all(&session).unwrap();
        fs::write(session.join("workspace.yaml"), "id: x\ncwd: /work/demo\nname: t\n").unwrap();
        let path = session.join(EVENTS_FILE);
        let line = |text: &str| format!("{}\n", record("user.message", json!({ "content": text })));
        fs::write(&path, line("old history")).unwrap();
        let mut monitor = CopilotMonitor::new(root.clone());
        monitor.started_at = SystemTime::now() + StdDuration::from_secs(60);
        assert!(monitor.poll(true, false).is_empty());
        assert!(monitor.poll(true, false).is_empty());

        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, line("new prompt").as_bytes()).unwrap();
        let events = monitor.poll(true, false);
        let again = monitor.poll(true, false);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id, "0b3e6589-demo");
        assert_eq!(events[0].content.as_deref(), Some("new prompt"));
        assert_eq!(events[0].project_path.as_deref(), Some("/work/demo"));
        assert!(again.is_empty());
    }
}
