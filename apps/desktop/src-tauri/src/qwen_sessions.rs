//! Reads only appended Qwen Code chat records (`~/.qwen/projects/<project>/chats/<session>.jsonl`)
//! and projects safe operational metadata into the shared event stream.
//! Historical transcripts are never backfilled; assistant text, thoughts, tool
//! outputs and API response text are never persisted.

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
const POLL_INTERVAL: StdDuration = StdDuration::from_millis(900);
const ACTIVE_FILE_WINDOW: Duration = Duration::hours(48);

#[derive(Default)]
struct SessionContext {
    id: String,
    project_path: Option<String>,
    model: Option<String>,
    active_tools: HashMap<String, (String, Option<String>, Option<String>)>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
}

pub struct QwenMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl QwenMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for (path, length) in recent_chats(&self.root) {
            if !self.cursors.contains_key(&path) {
                let created_before_start = fs::metadata(&path)
                    .and_then(|metadata| metadata.created())
                    .map(|created| created < self.started_at)
                    .unwrap_or(true);
                let offset = if created_before_start { length } else { 0 };
                self.cursors.insert(
                    path.clone(),
                    Cursor {
                        offset,
                        pending: Vec::new(),
                        context: SessionContext {
                            id: session_id_from_path(&path),
                            ..SessionContext::default()
                        },
                    },
                );
            }
            if let Some(cursor) = self.cursors.get_mut(&path) {
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

/// `%USERPROFILE%\.qwen\projects` on Windows, `$HOME/.qwen/projects` elsewhere.
pub fn projects_root() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".qwen")
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
        let mut monitor = QwenMonitor::new(root);
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

/// Chat files live exactly at `<root>/<project>/chats/<session>.jsonl`.
fn recent_chats(root: &Path) -> Vec<(PathBuf, u64)> {
    let cutoff = Utc::now() - ACTIVE_FILE_WINDOW;
    let mut files = Vec::new();
    let Ok(projects) = fs::read_dir(root) else {
        return files;
    };
    for project in projects.flatten() {
        let Ok(chats) = fs::read_dir(project.path().join("chats")) else {
            continue;
        };
        for entry in chats.flatten() {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
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
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("qwen-session")
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

fn project_record(
    record: &Value,
    context: &mut SessionContext,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    if let Some(id) = record.get("sessionId").and_then(Value::as_str) {
        context.id = id.to_owned();
    }
    if let Some(cwd) = record.get("cwd").and_then(Value::as_str) {
        context.project_path = Some(cwd.to_owned());
    }
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
    let payload = record.get("systemPayload");
    let subtype = record.get("subtype").and_then(Value::as_str);

    match (record.get("type").and_then(Value::as_str), subtype) {
        (Some("system"), Some("session_source"))
            if record.get("parentUuid").is_none_or(Value::is_null) =>
        {
            vec![at(event(context, EventKind::SessionStarted))]
        }
        (Some("system"), Some("session_model")) => {
            if let Some(model) = payload
                .and_then(|value| value.get("modelId"))
                .and_then(Value::as_str)
            {
                context.model = Some(model.to_owned());
            }
            Vec::new()
        }
        (Some("user"), None) => {
            // Injected records (notifications, tool plumbing) carry another provenance.
            let provenance = record.get("provenance").and_then(Value::as_str);
            if provenance.is_some_and(|value| value != "real_user") {
                return Vec::new();
            }
            let mut prompt = at(event(context, EventKind::UserMessage));
            if capture_prompts {
                prompt.content = message_text(record);
            }
            vec![prompt]
        }
        (Some("user"), Some("mid_turn_user_message")) => {
            let mut prompt = at(event(context, EventKind::UserMessage));
            if capture_prompts {
                prompt.content = payload
                    .and_then(|value| value.get("displayText"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            vec![prompt]
        }
        (Some("assistant"), _) => {
            if let Some(model) = record.get("model").and_then(Value::as_str) {
                context.model = Some(model.to_owned());
            }
            parts(record)
                .filter_map(|part| part.get("functionCall"))
                .map(|call| {
                    let name = call
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_owned();
                    let args = call.get("args");
                    let file_path = text_field(args, &["file_path", "absolute_path", "path"]);
                    let command = capture_commands
                        .then(|| text_field(args, &["command"]))
                        .flatten();
                    if let Some(id) = call.get("id").and_then(Value::as_str) {
                        context.active_tools.insert(
                            id.to_owned(),
                            (name.clone(), file_path.clone(), command.clone()),
                        );
                    }
                    let mut started = at(event(context, EventKind::ToolStarted));
                    started.tool_name = Some(name);
                    started.file_path = file_path;
                    started.command = command;
                    started
                })
                .collect()
        }
        (Some("tool_result"), _) => {
            let result = record.get("toolCallResult");
            let response = parts(record).find_map(|part| part.get("functionResponse"));
            let Some(call_id) = result
                .and_then(|value| value.get("callId"))
                .or_else(|| response.and_then(|value| value.get("id")))
                .and_then(Value::as_str)
            else {
                return Vec::new();
            };
            let (name, file_path, command) =
                context.active_tools.remove(call_id).unwrap_or_else(|| {
                    let name = response
                        .and_then(|value| value.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_owned();
                    (name, None, None)
                });
            let status = result
                .and_then(|value| value.get("status"))
                .and_then(Value::as_str);
            let kind = match status {
                Some("error" | "cancelled") => EventKind::ToolFailed,
                _ => EventKind::ToolFinished,
            };
            let mut finished = at(event(context, kind));
            finished.tool_name = Some(name);
            finished.file_path = file_path;
            finished.command = command;
            finished.outcome = status
                .filter(|value| *value != "success")
                .map(str::to_owned);
            vec![finished]
        }
        (Some("system"), Some("ui_telemetry")) => {
            let Some(ui) = payload.and_then(|value| value.get("uiEvent")) else {
                return Vec::new();
            };
            if ui.get("event.name").and_then(Value::as_str) != Some("qwen-code.api_response") {
                return Vec::new();
            }
            let mut usage = at(event(context, EventKind::ModelUsage));
            // `input_token_count` includes the cached part of the prompt
            // (OpenAI-compatible `prompt_tokens`), and `output_token_count`
            // already includes `thoughts_token_count`
            // (total = input + output in Qwen Code's telemetry).
            let cached = ui.get("cached_content_token_count").and_then(Value::as_u64);
            usage.input_tokens = ui
                .get("input_token_count")
                .and_then(Value::as_u64)
                .map(|input| match cached {
                    Some(cached) if cached > 0 => Sourced {
                        value: input.saturating_sub(cached),
                        origin: DataOrigin::Derived,
                    },
                    _ => provider_value(input),
                });
            usage.cache_read_tokens = cached.map(provider_value);
            usage.output_tokens = ui
                .get("output_token_count")
                .and_then(Value::as_u64)
                .map(provider_value);
            usage.duration_ms = ui
                .get("duration_ms")
                .and_then(Value::as_u64)
                .map(provider_value);
            if let Some(model) = ui.get("model").and_then(Value::as_str) {
                usage.model = Some(provider_string(model));
            }
            if usage.input_tokens.is_some() || usage.output_tokens.is_some() {
                vec![usage]
            } else {
                Vec::new()
            }
        }
        (Some("system"), Some("turn_result")) => {
            let mut checkpoint = at(event(context, EventKind::Checkpoint));
            let state = payload
                .and_then(|value| value.get("state"))
                .and_then(Value::as_str);
            checkpoint.outcome = state.map(|state| format!("turn-{state}"));
            let started = payload
                .and_then(|value| value.get("startedAt"))
                .and_then(Value::as_u64);
            let ended = payload
                .and_then(|value| value.get("endedAt"))
                .and_then(Value::as_u64);
            if let (Some(started), Some(ended)) = (started, ended) {
                checkpoint.duration_ms = Some(provider_value(ended.saturating_sub(started)));
            }
            vec![checkpoint]
        }
        _ => Vec::new(),
    }
}

fn event(context: &SessionContext, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(&context.id, Provider::QwenCode, kind);
    event.project_path = context.project_path.clone();
    event.model = context.model.as_deref().map(provider_string);
    event
}

fn parts(record: &Value) -> impl Iterator<Item = &Value> {
    record
        .get("message")
        .and_then(|message| message.get("parts"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn message_text(record: &Value) -> Option<String> {
    parts(record)
        .filter(|part| part.get("thought").is_none())
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::to_owned)
        .reduce(|mut prompt, part| {
            prompt.push('\n');
            prompt.push_str(&part);
            prompt
        })
}

fn text_field(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = value?.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::to_owned)
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

    fn record(kind: &str, extra: Value) -> Value {
        let mut base = json!({
            "uuid": "u", "parentUuid": "p", "sessionId": "qwen-session",
            "timestamp": "2026-10-21T08:00:00.000Z", "type": kind,
            "cwd": "/work/demo", "version": "0.25.3"
        });
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        base
    }

    #[test]
    fn tool_lifecycle_tracks_names_paths_and_gates_commands() {
        let mut context = SessionContext::default();
        let call = record(
            "assistant",
            json!({ "model": "qwen3-coder", "message": { "role": "model", "parts": [
                { "functionCall": { "id": "call-1", "name": "run_shell_command", "args": { "command": "rm -rf secret", "description": "x" } } },
                { "functionCall": { "id": "call-2", "name": "edit", "args": { "file_path": "/work/demo/src/main.rs", "old_string": "a", "new_string": "b" } } }
            ] } }),
        );
        let started = project_record(&call, &mut context, false, false);
        assert_eq!(started.len(), 2);
        assert_eq!(started[0].kind, EventKind::ToolStarted);
        assert_eq!(started[0].provider, Provider::QwenCode);
        assert_eq!(started[0].session_id, "qwen-session");
        assert_eq!(started[0].command, None);
        assert_eq!(
            started[1].file_path.as_deref(),
            Some("/work/demo/src/main.rs")
        );
        assert_eq!(
            started[1].model.as_ref().map(|value| value.value.as_str()),
            Some("qwen3-coder")
        );

        let failed = record(
            "tool_result",
            json!({ "message": { "role": "user", "parts": [ { "functionResponse": { "id": "call-2", "name": "edit", "response": { "output": "must not be retained" } } } ] },
                    "toolCallResult": { "callId": "call-2", "status": "error", "executionStatus": "error", "resultDisplay": "must not be retained" } }),
        );
        let failed = project_record(&failed, &mut context, true, true);
        assert_eq!(failed[0].kind, EventKind::ToolFailed);
        assert_eq!(failed[0].tool_name.as_deref(), Some("edit"));
        assert_eq!(
            failed[0].file_path.as_deref(),
            Some("/work/demo/src/main.rs")
        );
        assert_eq!(failed[0].outcome.as_deref(), Some("error"));
        assert_eq!(failed[0].content, None);

        let mut context = SessionContext::default();
        let captured = project_record(&call, &mut context, false, true);
        assert_eq!(captured[0].command.as_deref(), Some("rm -rf secret"));
    }

    #[test]
    fn prompts_are_opt_in_and_injected_user_records_are_ignored() {
        let mut context = SessionContext::default();
        let prompt = record(
            "user",
            json!({ "provenance": "real_user", "message": { "role": "user", "parts": [ { "text": "private prompt" } ] } }),
        );
        assert_eq!(
            project_record(&prompt, &mut context, false, false)[0].content,
            None
        );
        let captured = project_record(&prompt, &mut context, true, false);
        assert_eq!(captured[0].kind, EventKind::UserMessage);
        assert_eq!(captured[0].content.as_deref(), Some("private prompt"));

        let injected = record(
            "user",
            json!({ "provenance": "system", "message": { "role": "user", "parts": [ { "text": "plumbing" } ] } }),
        );
        assert!(project_record(&injected, &mut context, true, false).is_empty());
        let notification = record(
            "user",
            json!({ "subtype": "notification", "systemPayload": { "displayText": "done" } }),
        );
        assert!(project_record(&notification, &mut context, true, false).is_empty());
    }

    #[test]
    fn api_usage_and_turn_results_keep_provider_values_only() {
        let mut context = SessionContext::default();
        let usage = record(
            "system",
            json!({ "subtype": "ui_telemetry", "systemPayload": { "uiEvent": {
                "event.name": "qwen-code.api_response", "model": "qwen3-coder",
                "input_token_count": 1200, "output_token_count": 80, "duration_ms": 900,
                "response_text": "must not be retained"
            } } }),
        );
        let usage = project_record(&usage, &mut context, true, true);
        assert_eq!(usage[0].kind, EventKind::ModelUsage);
        assert_eq!(
            usage[0].input_tokens.as_ref().map(|value| value.value),
            Some(1200)
        );
        assert_eq!(
            usage[0].output_tokens.as_ref().map(|value| value.value),
            Some(80)
        );
        assert_eq!(usage[0].content, None);

        let cached = record(
            "system",
            json!({ "subtype": "ui_telemetry", "systemPayload": { "uiEvent": {
                "event.name": "qwen-code.api_response", "model": "deepseek-v4-pro",
                "input_token_count": 22925, "output_token_count": 82,
                "cached_content_token_count": 22784, "thoughts_token_count": 13,
                "total_token_count": 23007
            } } }),
        );
        let cached = project_record(&cached, &mut context, false, false);
        let input = cached[0].input_tokens.as_ref().unwrap();
        assert_eq!(input.value, 22925 - 22784);
        assert_eq!(input.origin, DataOrigin::Derived);
        assert_eq!(
            cached[0]
                .cache_read_tokens
                .as_ref()
                .map(|value| value.value),
            Some(22784)
        );
        assert_eq!(
            cached[0].output_tokens.as_ref().map(|value| value.value),
            Some(82)
        );

        let tool_call = record(
            "system",
            json!({ "subtype": "ui_telemetry", "systemPayload": { "uiEvent": { "event.name": "qwen-code.tool_call" } } }),
        );
        assert!(project_record(&tool_call, &mut context, true, true).is_empty());

        let turn = record(
            "system",
            json!({ "subtype": "turn_result", "systemPayload": { "state": "completed", "stopReason": "end_turn",
                "startedAt": 1000, "endedAt": 4500, "promptText": "must not be retained" } }),
        );
        let turn = project_record(&turn, &mut context, true, true);
        assert_eq!(turn[0].kind, EventKind::Checkpoint);
        assert_eq!(turn[0].outcome.as_deref(), Some("turn-completed"));
        assert_eq!(
            turn[0].duration_ms.as_ref().map(|value| value.value),
            Some(3500)
        );
        assert_eq!(turn[0].content, None);
    }

    #[test]
    fn only_appended_lines_of_preexisting_chats_are_read() {
        let root = env::temp_dir().join(format!("agent-observer-qwen-{}", uuid::Uuid::new_v4()));
        let chats = root.join("-work-demo").join("chats");
        fs::create_dir_all(&chats).unwrap();
        let path = chats.join("qwen-session.jsonl");
        let line = |text: &str| {
            format!(
                "{}\n",
                record(
                    "user",
                    json!({ "provenance": "real_user", "message": { "parts": [ { "text": text } ] } })
                )
            )
        };
        fs::write(&path, line("old history")).unwrap();
        let mut monitor = QwenMonitor::new(root.clone());
        monitor.started_at = SystemTime::now() + StdDuration::from_secs(60);
        assert!(monitor.poll(true, false).is_empty());

        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, line("new prompt").as_bytes()).unwrap();
        let events = monitor.poll(true, false);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content.as_deref(), Some("new prompt"));
        assert_eq!(events[0].project_path.as_deref(), Some("/work/demo"));
    }
}
