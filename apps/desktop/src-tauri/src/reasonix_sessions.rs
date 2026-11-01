//! Reads only appended Reasonix wire records
//! (`~/.reasonix/projects/<project>/sessions/<session>.wire.jsonl`, written by Reasonix Studio and
//! the Reasonix CLI) and projects safe operational metadata into the shared event stream.
//! Historical sessions are never backfilled; assistant text, tool arguments other than the
//! target path, and tool outputs are never persisted.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::{HashMap, HashSet},
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
const WIRE_SUFFIX: &str = ".wire.jsonl";

#[derive(Default)]
struct SessionContext {
    id: String,
    model: Option<String>,
    started: bool,
    active_tools: HashSet<String>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
}

pub struct ReasonixMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl ReasonixMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for (path, length) in recent_wires(&self.root) {
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
                        context: SessionContext {
                            id: session_id_from_path(&path),
                            // A session already running at startup has no observable start.
                            started: created_before_start,
                            ..SessionContext::default()
                        },
                    },
                );
            }
            // Unchanged files are skipped without opening them: opening ~every recent file each
            // second is what makes polling costly on Windows (antivirus filters).
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

/// `%USERPROFILE%\.reasonix\projects` on Windows, `$HOME/.reasonix/projects` elsewhere.
pub fn projects_root() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".reasonix")
        .join("projects")
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
        let mut monitor = ReasonixMonitor::new(root);
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

/// Wire logs live exactly at `<root>/<project>/sessions/<session>.wire.jsonl`.
fn recent_wires(root: &Path) -> Vec<(PathBuf, u64)> {
    let cutoff = Utc::now() - ACTIVE_FILE_WINDOW;
    let mut files = Vec::new();
    let Ok(projects) = fs::read_dir(root) else {
        return files;
    };
    for project in projects.flatten() {
        let Ok(sessions) = fs::read_dir(project.path().join("sessions")) else {
            continue;
        };
        for entry in sessions.flatten() {
            let path = entry.path();
            let is_wire = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(WIRE_SUFFIX));
            if !is_wire {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let Ok(modified) = metadata.modified() else {
                continue;
            };
            if metadata.is_file() && DateTime::<Utc>::from(modified) >= cutoff {
                files.push((path, metadata.len()));
            }
        }
    }
    files
}

fn session_id_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix(WIRE_SUFFIX))
        .unwrap_or("reasonix-session")
        .to_owned()
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
        cursor.context = SessionContext {
            id: session_id_from_path(path),
            ..SessionContext::default()
        };
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

// shortcut: wire records carry no timestamp and no working directory, so events are stamped when
// read (≤ 1 s late; tool results use the tool's own end time) and carry no project_path.
fn project_record(
    record: &Value,
    context: &mut SessionContext,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    match record.get("kind").and_then(Value::as_str) {
        Some("turn_started") => {
            if let Some(model) = record.get("modelRef").and_then(Value::as_str) {
                context.model = Some(model.to_owned());
            }
            let mut events = Vec::new();
            if !context.started {
                context.started = true;
                events.push(event(context, EventKind::SessionStarted));
            }
            let mut prompt = event(context, EventKind::UserMessage);
            if capture_prompts {
                prompt.content = record.get("text").and_then(Value::as_str).map(str::to_owned);
            }
            events.push(prompt);
            events
        }
        Some("tool_dispatch") => {
            let Some((id, name)) = tool_identity(record) else {
                return Vec::new();
            };
            // Streaming repeats a dispatch with `partial: true`; only the first complete one counts.
            let partial = record
                .get("tool")
                .and_then(|tool| tool.get("partial"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if partial || !context.active_tools.insert(id.to_owned()) {
                return Vec::new();
            }
            let mut started = event(context, EventKind::ToolStarted);
            started.tool_name = Some(name.to_owned());
            vec![started]
        }
        Some("tool_result") => {
            let Some((id, name)) = tool_identity(record) else {
                return Vec::new();
            };
            context.active_tools.remove(id);
            let tool = &record["tool"];
            let state = tool
                .get("execution")
                .and_then(|execution| execution.get("state"))
                .and_then(Value::as_str);
            let kind = if state == Some("failed") {
                EventKind::ToolFailed
            } else {
                EventKind::ToolFinished
            };
            let args = tool
                .get("args")
                .and_then(Value::as_str)
                .and_then(|args| serde_json::from_str::<Value>(args).ok());
            let mut finished = event(context, kind);
            finished.tool_name = Some(name.to_owned());
            finished.file_path = text_field(args.as_ref(), "path");
            finished.command = capture_commands
                .then(|| text_field(args.as_ref(), "command"))
                .flatten();
            finished.duration_ms = tool
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(provider_value);
            finished.outcome = state
                .filter(|value| *value != "completed")
                .map(str::to_owned);
            if let Some(ended) = tool
                .get("endedAt")
                .and_then(Value::as_i64)
                .and_then(DateTime::from_timestamp_millis)
            {
                finished.occurred_at = ended;
            }
            vec![finished]
        }
        Some("usage") => {
            let Some(usage) = record.get("usage") else {
                return Vec::new();
            };
            let number = |key: &str| usage.get(key).and_then(Value::as_u64);
            let cached = number("cacheHitTokens");
            let mut model = event(context, EventKind::ModelUsage);
            // `cacheMissTokens` is the uncached part of the prompt, as `input_tokens` expects.
            model.input_tokens = number("cacheMissTokens").map(provider_value).or_else(|| {
                number("promptTokens").map(|prompt| Sourced {
                    value: prompt.saturating_sub(cached.unwrap_or(0)),
                    origin: DataOrigin::Derived,
                })
            });
            model.cache_read_tokens = cached.map(provider_value);
            model.output_tokens = number("completionTokens").map(provider_value);
            if let Some(name) = usage
                .get("costQuote")
                .and_then(|quote| quote.get("modelRef"))
                .and_then(Value::as_str)
            {
                model.model = Some(provider_string(name));
            }
            if model.input_tokens.is_some() || model.output_tokens.is_some() {
                vec![model]
            } else {
                Vec::new()
            }
        }
        Some("turn_done") => {
            let mut checkpoint = event(context, EventKind::Checkpoint);
            // A turn the user stopped is not a failed turn.
            checkpoint.outcome = Some(
                if record.get("cancelled").and_then(Value::as_bool) == Some(true) {
                    "turn-cancelled"
                } else if record.get("err").is_some_and(|err| !err.is_null()) {
                    "turn-error"
                } else {
                    "turn-completed"
                }
                .to_owned(),
            );
            checkpoint.duration_ms = record
                .get("workDurationMs")
                .and_then(Value::as_u64)
                .map(provider_value);
            vec![checkpoint]
        }
        _ => Vec::new(),
    }
}

fn tool_identity(record: &Value) -> Option<(&str, &str)> {
    let tool = record.get("tool")?;
    Some((
        tool.get("id")?.as_str()?,
        tool.get("name")?.as_str()?,
    ))
}

fn event(context: &SessionContext, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(&context.id, Provider::Reasonix, kind);
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
    fn tool_lifecycle_ignores_partial_dispatches_and_gates_commands() {
        let records = [
            json!({ "kind": "tool_dispatch", "tool": { "id": "t1", "name": "bash", "partial": true } }),
            json!({ "kind": "tool_dispatch", "tool": { "id": "t1", "name": "bash" } }),
            json!({ "kind": "tool_dispatch", "tool": { "id": "t1", "name": "bash" } }),
            json!({ "kind": "tool_result", "tool": { "id": "t1", "name": "bash", "durationMs": 40,
                "args": "{\"command\":\"rm -rf secret\"}", "output": "must not be retained",
                "startedAt": 1_793_473_634_917_i64, "endedAt": 1_793_473_635_075_i64,
                "execution": { "state": "completed", "exitCode": 0 } } }),
            json!({ "kind": "tool_result", "tool": { "id": "t2", "name": "edit_file",
                "args": "{\"path\":\"/work/demo/src/main.rs\"}", "execution": { "state": "failed", "exitCode": 1 } } }),
        ];
        let events = run(&records, true, false);
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].kind, EventKind::ToolStarted);
        assert_eq!(events[0].provider, Provider::Reasonix);
        assert_eq!(events[1].kind, EventKind::ToolFinished);
        assert_eq!(events[1].command, None);
        assert_eq!(events[1].outcome, None);
        assert_eq!(events[1].duration_ms.as_ref().map(|value| value.value), Some(40));
        assert_eq!(events[1].occurred_at.timestamp_millis(), 1_793_473_635_075);
        assert_eq!(events[2].kind, EventKind::ToolFailed);
        assert_eq!(events[2].file_path.as_deref(), Some("/work/demo/src/main.rs"));
        assert_eq!(events[2].outcome.as_deref(), Some("failed"));
        assert!(events.iter().all(|event| event.content.is_none()));

        let captured = run(&records[3..4], false, true);
        assert_eq!(captured[0].command.as_deref(), Some("rm -rf secret"));
    }

    #[test]
    fn prompts_are_opt_in_and_the_session_starts_once() {
        let records = [
            json!({ "kind": "turn_started", "text": "private prompt", "modelRef": "p/m" }),
            json!({ "kind": "turn_started", "text": "second", "modelRef": "p/m" }),
        ];
        let hidden = run(&records, false, false);
        assert_eq!(
            hidden.iter().map(|event| event.kind).collect::<Vec<_>>(),
            [EventKind::SessionStarted, EventKind::UserMessage, EventKind::UserMessage]
        );
        assert!(hidden.iter().all(|event| event.content.is_none()));
        assert_eq!(hidden[1].model.as_ref().map(|value| value.value.as_str()), Some("p/m"));
        let shown = run(&records, true, false);
        assert_eq!(shown[1].content.as_deref(), Some("private prompt"));
    }

    #[test]
    fn usage_keeps_provider_values_and_turns_report_their_outcome() {
        let events = run(
            &[
                json!({ "kind": "usage", "usage": { "promptTokens": 1200, "completionTokens": 80,
                    "cacheHitTokens": 1000, "cacheMissTokens": 200 } }),
                json!({ "kind": "usage", "usage": { "promptTokens": 500, "cacheHitTokens": 100 } }),
                json!({ "kind": "usage", "usage": { "totalTokens": 0 } }),
                json!({ "kind": "turn_done", "workDurationMs": 2564 }),
                json!({ "kind": "turn_done", "err": "boom" }),
                json!({ "kind": "turn_done", "err": "stopped", "cancelled": true }),
            ],
            true,
            true,
        );
        assert_eq!(events.len(), 5);
        assert_eq!(events[0].input_tokens.as_ref().map(|value| value.value), Some(200));
        assert_eq!(events[0].input_tokens.as_ref().map(|value| value.origin), Some(DataOrigin::Provider));
        assert_eq!(events[0].cache_read_tokens.as_ref().map(|value| value.value), Some(1000));
        assert_eq!(events[0].output_tokens.as_ref().map(|value| value.value), Some(80));
        assert_eq!(events[1].input_tokens.as_ref().map(|value| (value.value, value.origin)), Some((400, DataOrigin::Derived)));
        assert_eq!(events[2].outcome.as_deref(), Some("turn-completed"));
        assert_eq!(events[2].duration_ms.as_ref().map(|value| value.value), Some(2564));
        assert_eq!(events[3].outcome.as_deref(), Some("turn-error"));
        assert_eq!(events[4].outcome.as_deref(), Some("turn-cancelled"));
    }

    #[test]
    fn only_appended_lines_are_read_and_unchanged_files_are_skipped() {
        let root = env::temp_dir().join(format!("agent-observer-reasonix-{}", uuid::Uuid::new_v4()));
        let sessions = root.join("-work-demo").join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        let path = sessions.join("20261101-demo.wire.jsonl");
        let line = |text: &str| format!("{}\n", json!({ "kind": "turn_started", "text": text }));
        fs::write(&path, line("old history")).unwrap();
        let mut monitor = ReasonixMonitor::new(root.clone());
        monitor.started_at = SystemTime::now() + StdDuration::from_secs(60);
        assert!(monitor.poll(true, false).is_empty());
        assert!(monitor.poll(true, false).is_empty());

        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, line("new prompt").as_bytes()).unwrap();
        let events = monitor.poll(true, false);
        let again = monitor.poll(true, false);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id, "20261101-demo");
        assert_eq!(events[0].content.as_deref(), Some("new prompt"));
        assert!(again.is_empty());
    }
}
