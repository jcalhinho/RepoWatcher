//! Reads only appended Codex rollout records and projects safe operational
//! metadata into the shared event stream. Historical transcript contents are
//! never backfilled.

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
    has_started: bool,
    active_tools: HashMap<String, (String, Option<String>, Option<String>)>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
}

pub struct RolloutMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl RolloutMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let files = recent_rollouts(&self.root);
        let mut events = Vec::new();
        for (path, length) in files {
            if !self.cursors.contains_key(&path) {
                let created_before_start = fs::metadata(&path)
                    .and_then(|metadata| metadata.created())
                    .map(|created| created < self.started_at)
                    .unwrap_or(true);
                let offset = if created_before_start { length } else { 0 };
                let mut context = SessionContext {
                    id: session_id_from_path(&path),
                    ..SessionContext::default()
                };
                if offset == length {
                    seed_context(&path, &mut context);
                }
                self.cursors.insert(
                    path.clone(),
                    Cursor {
                        offset,
                        pending: Vec::new(),
                        context,
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

pub fn sessions_root() -> PathBuf {
    let home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let codex_home = if env::var_os("CODEX_HOME").is_some() {
        home
    } else {
        home.join(".codex")
    };
    codex_home.join("sessions")
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
        let mut monitor = RolloutMonitor::new(root);
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

fn recent_rollouts(root: &Path) -> Vec<(PathBuf, u64)> {
    let cutoff = Utc::now() - ACTIVE_FILE_WINDOW;
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
                && let Ok(metadata) = entry.metadata()
                && let Ok(modified) = metadata.modified()
            {
                let modified: DateTime<Utc> = modified.into();
                if modified >= cutoff {
                    files.push((path, metadata.len()));
                }
            }
        }
    }
    files
}

fn session_id_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(|stem| stem.rsplit('-').next())
        .unwrap_or("codex-session")
        .to_owned()
}

fn seed_context(path: &Path, context: &mut SessionContext) {
    let Ok(mut file) = fs::File::open(path) else {
        return;
    };
    let mut start = vec![0; 128 * 1024];
    if let Ok(count) = file.read(&mut start) {
        for line in start[..count].split(|byte| *byte == b'\n') {
            update_context(line, context);
        }
    }
    let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let tail_length = length.min(1024 * 1024) as usize;
    if tail_length == 0 || file.seek(SeekFrom::End(-(tail_length as i64))).is_err() {
        return;
    }
    let mut tail = vec![0; tail_length];
    if let Ok(count) = file.read(&mut tail) {
        for line in tail[..count].split(|byte| *byte == b'\n') {
            update_context(line, context);
        }
    }
}

fn update_context(line: &[u8], context: &mut SessionContext) {
    let Ok(record) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    let Some(payload) = record.get("payload") else {
        return;
    };
    match record.get("type").and_then(Value::as_str) {
        Some("session_meta") => {
            if let Some(id) = payload
                .get("id")
                .or_else(|| payload.get("session_id"))
                .and_then(Value::as_str)
            {
                context.id = id.to_owned();
            }
            if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                context.project_path = Some(cwd.to_owned());
            }
        }
        Some("turn_context") => {
            if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                context.project_path = Some(cwd.to_owned());
            }
            if let Some(model) = payload.get("model").and_then(Value::as_str) {
                context.model = Some(model.to_owned());
            }
        }
        _ => {}
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
        if newline <= MAX_LINE_BYTES {
            if let Ok(record) = serde_json::from_slice::<Value>(&cursor.pending[..newline]) {
                if let Some(event) = project_record(
                    &record,
                    &mut cursor.context,
                    capture_prompts,
                    capture_commands,
                ) {
                    events.push(event);
                }
            }
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
) -> Option<SessionEvent> {
    let timestamp = record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|timestamp| DateTime::parse_from_rfc3339(timestamp).ok())
        .map(|timestamp| timestamp.with_timezone(&Utc));
    let record_type = record.get("type")?.as_str()?;
    let payload = record.get("payload")?;

    if record_type == "session_meta" {
        context.id = payload
            .get("id")
            .or_else(|| payload.get("session_id"))
            .and_then(Value::as_str)
            .unwrap_or(&context.id)
            .to_owned();
        context.project_path = payload
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mut event = event(context, EventKind::SessionStarted);
        event.occurred_at = timestamp.unwrap_or_else(Utc::now);
        context.has_started = true;
        return Some(event);
    }

    if record_type == "turn_context" {
        context.project_path = payload
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or(context.project_path.take());
        context.model = payload
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_owned);
        return None;
    }

    if record_type == "event_msg" {
        let event_type = payload.get("type")?.as_str()?;
        return match event_type {
            "task_started" => {
                let kind = if context.has_started {
                    EventKind::Checkpoint
                } else {
                    context.has_started = true;
                    EventKind::SessionStarted
                };
                let mut event = event(context, kind);
                event.occurred_at = timestamp.unwrap_or_else(Utc::now);
                event.outcome = payload
                    .get("turn_id")
                    .and_then(Value::as_str)
                    .map(|turn| format!("turn-started:{turn}"));
                Some(event)
            }
            "task_complete" => {
                let mut event = event(context, EventKind::Checkpoint);
                event.occurred_at = timestamp.unwrap_or_else(Utc::now);
                event.duration_ms = payload
                    .get("duration_ms")
                    .and_then(Value::as_u64)
                    .map(provider_value);
                event.outcome = payload
                    .get("turn_id")
                    .and_then(Value::as_str)
                    .map(|turn| format!("turn-complete:{turn}"));
                Some(event)
            }
            "token_count" => {
                let usage = payload.get("info")?.get("last_token_usage")?;
                let mut event = event(context, EventKind::ModelUsage);
                event.occurred_at = timestamp.unwrap_or_else(Utc::now);
                project_token_usage(usage, &mut event);
                event.model = context.model.as_deref().map(provider_string);
                (event.input_tokens.is_some() || event.output_tokens.is_some()).then_some(event)
            }
            "item_completed" => project_completed_item(payload, context, timestamp),
            _ => None,
        };
    }

    if record_type == "response_item" {
        return match payload.get("type")?.as_str()? {
            "message" if payload.get("role").and_then(Value::as_str) == Some("user") => {
                let mut event = event(context, EventKind::UserMessage);
                event.occurred_at = timestamp.unwrap_or_else(Utc::now);
                if capture_prompts {
                    event.content = message_text(payload);
                }
                Some(event)
            }
            "custom_tool_call" | "function_call" => {
                let call_id = payload
                    .get("call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let name = payload
                    .get("name")
                    .or_else(|| payload.get("namespace"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_owned();
                let input = payload.get("input").or_else(|| payload.get("arguments"));
                let file_path = find_text(input, &["file_path", "path", "target_file"]);
                let command = capture_commands
                    .then(|| find_text(input, &["command", "cmd", "script", "command_line"]))
                    .flatten();
                if !call_id.is_empty() {
                    context.active_tools.insert(
                        call_id.to_owned(),
                        (name.clone(), file_path.clone(), command.clone()),
                    );
                }
                let mut event = event(context, EventKind::ToolStarted);
                event.occurred_at = timestamp.unwrap_or_else(Utc::now);
                event.tool_name = Some(name);
                event.file_path = file_path;
                event.command = command;
                Some(event)
            }
            "custom_tool_call_output" | "function_call_output" => {
                let call_id = payload
                    .get("call_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let details = context.active_tools.remove(call_id)?;
                let mut event = event(context, EventKind::ToolFinished);
                event.occurred_at = timestamp.unwrap_or_else(Utc::now);
                event.tool_name = Some(details.0);
                event.file_path = details.1;
                event.command = details.2;
                Some(event)
            }
            _ => None,
        };
    }
    None
}

/// OpenAI usage semantics (Responses API, prompt caching guide): `input_tokens`
/// counts every prompt token, cache reads (`cached_input_tokens`) and cache
/// writes (`cache_write_input_tokens`) included, so the uncached part is what
/// remains. `output_tokens` already includes `reasoning_output_tokens`, which
/// are billed as output: they are not added again.
fn project_token_usage(usage: &Value, event: &mut SessionEvent) {
    let count = |key: &str| usage.get(key).and_then(Value::as_u64);
    let cache_read = count("cached_input_tokens");
    let cache_write = count("cache_write_input_tokens");
    event.input_tokens = count("input_tokens").map(|input| {
        if cache_read.is_none() && cache_write.is_none() {
            return provider_value(input);
        }
        let cached = cache_read.unwrap_or(0) + cache_write.unwrap_or(0);
        Sourced {
            value: input.saturating_sub(cached),
            origin: DataOrigin::Derived,
        }
    });
    event.cache_read_tokens = cache_read.map(provider_value);
    event.cache_write_tokens = cache_write.map(provider_value);
    event.output_tokens = count("output_tokens").map(provider_value);
}

fn project_completed_item(
    payload: &Value,
    context: &mut SessionContext,
    timestamp: Option<DateTime<Utc>>,
) -> Option<SessionEvent> {
    let item = payload.get("item")?;
    let item_type = item.get("type")?.as_str()?;
    if !matches!(item_type, "custom_tool_call" | "function_call") {
        return None;
    }
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let details = context.active_tools.remove(call_id)?;
    let mut event = event(context, EventKind::ToolFinished);
    event.occurred_at = timestamp.unwrap_or_else(Utc::now);
    event.tool_name = item
        .get("name")
        .or_else(|| item.get("namespace"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or(Some(details.0));
    event.file_path = details.1;
    event.command = details.2;
    if let (Some(started), Some(completed)) = (
        payload.get("started_at_ms").and_then(Value::as_u64),
        payload.get("completed_at_ms").and_then(Value::as_u64),
    ) {
        event.duration_ms = Some(provider_value(completed.saturating_sub(started)));
    }
    Some(event)
}

fn event(context: &SessionContext, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(&context.id, Provider::Codex, kind);
    event.project_path = context.project_path.clone();
    event.model = context.model.as_deref().map(provider_string);
    event
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

fn message_text(payload: &Value) -> Option<String> {
    payload
        .get("content")?
        .as_array()?
        .iter()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("input_text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::to_owned)
        .reduce(|mut prompt, part| {
            prompt.push('\n');
            prompt.push_str(&part);
            prompt
        })
}

fn find_text(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
            return find_text(Some(&parsed), keys);
        }
        return None;
    }
    if let Some(object) = value.as_object() {
        for key in keys {
            if let Some(text) = object.get(*key).and_then(Value::as_str) {
                return Some(text.to_owned());
            }
        }
        for child in object.values() {
            if let Some(text) = find_text(Some(child), keys) {
                return Some(text);
            }
        }
    } else if let Some(array) = value.as_array() {
        for child in array {
            if let Some(text) = find_text(Some(child), keys) {
                return Some(text);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn provider_token_usage_is_projected_without_estimating_missing_fields() {
        let mut context = SessionContext {
            id: "codex-session".into(),
            model: Some("gpt-test".into()),
            ..SessionContext::default()
        };
        let record = json!({
            "type": "event_msg",
            "timestamp": "2026-01-01T00:00:00Z",
            "payload": { "type": "token_count", "info": { "last_token_usage": {
                "input_tokens": 321, "output_tokens": 54
            } } }
        });
        let event = project_record(&record, &mut context, false, false)
            .expect("token event should be observed");

        assert_eq!(event.kind, EventKind::ModelUsage);
        assert_eq!(
            event.input_tokens.as_ref().map(|value| value.value),
            Some(321)
        );
        assert_eq!(
            event.output_tokens.as_ref().map(|value| value.value),
            Some(54)
        );
        assert_eq!(
            event.model.as_ref().map(|value| value.value.as_str()),
            Some("gpt-test")
        );
        assert_eq!(event.input_tokens.unwrap().origin, DataOrigin::Provider);
    }

    #[test]
    fn cached_prompt_tokens_are_split_from_uncached_input() {
        let mut context = SessionContext {
            id: "codex-session".into(),
            model: Some("gpt-5.6-luna".into()),
            ..SessionContext::default()
        };
        let record = json!({
            "type": "event_msg",
            "timestamp": "2026-01-01T00:00:00Z",
            "payload": { "type": "token_count", "info": { "last_token_usage": {
                "input_tokens": 26391, "cached_input_tokens": 26112,
                "cache_write_input_tokens": 200, "output_tokens": 117,
                "reasoning_output_tokens": 40, "total_tokens": 26508
            } } }
        });
        let event = project_record(&record, &mut context, false, false).unwrap();

        let input = event.input_tokens.unwrap();
        assert_eq!(input.value, 26391 - 26112 - 200);
        assert_eq!(input.origin, DataOrigin::Derived);
        assert_eq!(
            event.cache_read_tokens.map(|value| value.value),
            Some(26112)
        );
        assert_eq!(event.cache_write_tokens.map(|value| value.value), Some(200));
        // Reasoning is part of output_tokens: not added a second time.
        assert_eq!(event.output_tokens.map(|value| value.value), Some(117));
    }

    #[test]
    fn prompt_and_shell_command_are_excluded_until_opted_in() {
        let prompt = json!({ "type": "response_item", "payload": {
            "type": "message", "role": "user", "content": [
                { "type": "input_text", "text": "private prompt" }
            ]
        } });
        let tool = json!({ "type": "response_item", "payload": {
            "type": "custom_tool_call", "call_id": "call-1", "name": "shell",
            "input": { "command": "echo private" }
        } });
        let mut context = SessionContext::default();

        let omitted_prompt = project_record(&prompt, &mut context, false, false).unwrap();
        let captured_prompt = project_record(&prompt, &mut context, true, false).unwrap();
        let omitted_command = project_record(&tool, &mut context, false, false).unwrap();
        let captured_command = project_record(&tool, &mut context, false, true).unwrap();

        assert_eq!(omitted_prompt.content, None);
        assert_eq!(captured_prompt.content.as_deref(), Some("private prompt"));
        assert_eq!(omitted_command.command, None);
        assert_eq!(captured_command.command.as_deref(), Some("echo private"));
    }
}
