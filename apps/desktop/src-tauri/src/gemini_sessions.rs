//! Follows Gemini CLI's local chat recording files without retaining model
//! responses, thoughts, or tool results.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use sha2::{Digest, Sha256};
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
use uuid::Uuid;

const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: u64 = 32 * 1024 * 1024;
const ACTIVE_FILE_WINDOW: Duration = Duration::hours(48);

#[derive(Default)]
struct SessionContext {
    session_id: String,
    project_hash: String,
    project_path: Option<String>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
    message_fingerprints: HashMap<String, String>,
    tool_calls: HashMap<String, (String, Option<String>, Option<String>)>,
    legacy_modified: Option<SystemTime>,
}

pub struct GeminiMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
    started_utc: DateTime<Utc>,
}

impl GeminiMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
            started_utc: Utc::now(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let files = recent_session_files(&self.root);
        let mut events = Vec::new();
        for (path, length, modified) in files {
            let is_jsonl = path.extension().and_then(|ext| ext.to_str()) == Some("jsonl");
            if !self.cursors.contains_key(&path) {
                let created_before_start = fs::metadata(&path)
                    .and_then(|metadata| metadata.created())
                    .map(|created| created < self.started_at)
                    .unwrap_or(true);
                let offset = if created_before_start { length } else { 0 };
                let mut cursor = Cursor {
                    offset,
                    pending: Vec::new(),
                    context: SessionContext::default(),
                    message_fingerprints: HashMap::new(),
                    tool_calls: HashMap::new(),
                    legacy_modified: created_before_start.then_some(modified).flatten(),
                };
                if is_jsonl && offset > 0 {
                    seed_jsonl_context(&path, &mut cursor.context);
                } else if !is_jsonl && offset > 0 {
                    seed_legacy_snapshot(&path, &mut cursor);
                }
                self.cursors.insert(path.clone(), cursor);
            }
            if let Some(cursor) = self.cursors.get_mut(&path) {
                if is_jsonl {
                    events.extend(read_appended(
                        &path,
                        cursor,
                        self.started_utc,
                        capture_prompts,
                        capture_commands,
                    ));
                } else if cursor.legacy_modified != modified {
                    cursor.legacy_modified = modified;
                    events.extend(read_legacy_snapshot(
                        &path,
                        cursor,
                        self.started_utc,
                        capture_prompts,
                        capture_commands,
                    ));
                }
            }
        }
        events
    }
}

pub fn sessions_root() -> PathBuf {
    let home = env::var_os("GEMINI_CLI_HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let gemini_home = if env::var_os("GEMINI_CLI_HOME").is_some() {
        home
    } else {
        home.join(".gemini")
    };
    gemini_home.join("tmp")
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
        let mut monitor = GeminiMonitor::new(root);
        loop {
            for event in monitor.poll(
                capture_prompts.load(Ordering::Relaxed),
                capture_commands.load(Ordering::Relaxed),
            ) {
                on_event(event);
            }
            thread::sleep(StdDuration::from_millis(1200));
        }
    });
}

fn recent_session_files(root: &Path) -> Vec<(PathBuf, u64, Option<SystemTime>)> {
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
                continue;
            }
            let extension = path.extension().and_then(|extension| extension.to_str());
            let is_jsonl = extension == Some("jsonl");
            let is_legacy_session = extension == Some("json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("session-"));
            let supported = is_jsonl || is_legacy_session;
            if !kind.is_file() || !supported {
                continue;
            }
            if let Ok(metadata) = entry.metadata() {
                let modified = metadata.modified().ok();
                let recent = modified
                    .and_then(|time| DateTime::<Utc>::from(time).ge(&cutoff).then_some(time))
                    .is_some();
                if recent {
                    files.push((path, metadata.len(), modified));
                }
            }
        }
    }
    files
}

fn seed_jsonl_context(path: &Path, context: &mut SessionContext) {
    let Ok(mut file) = fs::File::open(path) else {
        return;
    };
    let mut first = vec![0; 64 * 1024];
    if let Ok(count) = file.read(&mut first) {
        for line in first[..count].split(|byte| *byte == b'\n') {
            if let Ok(record) = serde_json::from_slice::<Value>(line) {
                update_context(&record, context);
            }
        }
    }
}

fn seed_legacy_snapshot(path: &Path, cursor: &mut Cursor) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() > MAX_SNAPSHOT_BYTES {
        return;
    }
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Ok(snapshot) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    update_context(&snapshot, &mut cursor.context);
    remember_messages(&snapshot, cursor);
}

fn read_legacy_snapshot(
    path: &Path,
    cursor: &mut Cursor,
    started_utc: DateTime<Utc>,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let Ok(metadata) = fs::metadata(path) else {
        return Vec::new();
    };
    if metadata.len() > MAX_SNAPSHOT_BYTES {
        return Vec::new();
    }
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let Ok(snapshot) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    update_context(&snapshot, &mut cursor.context);
    project_messages(
        snapshot.get("messages").and_then(Value::as_array),
        cursor,
        started_utc,
        capture_prompts,
        capture_commands,
    )
}

fn read_appended(
    path: &Path,
    cursor: &mut Cursor,
    started_utc: DateTime<Utc>,
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
        cursor.message_fingerprints.clear();
        cursor.tool_calls.clear();
        cursor.context = SessionContext::default();
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
        if newline <= MAX_RECORD_BYTES
            && let Ok(record) = serde_json::from_slice::<Value>(&cursor.pending[..newline])
        {
            events.extend(project_record(
                &record,
                cursor,
                started_utc,
                capture_prompts,
                capture_commands,
            ));
        }
        cursor.pending.drain(..=newline);
    }
    if cursor.pending.len() > MAX_RECORD_BYTES {
        cursor.pending.clear();
    }
    events
}

fn project_record(
    record: &Value,
    cursor: &mut Cursor,
    started_utc: DateTime<Utc>,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    update_context(record, &mut cursor.context);
    if let Some(messages) = record.get("messages").and_then(Value::as_array) {
        return project_messages(
            Some(messages),
            cursor,
            started_utc,
            capture_prompts,
            capture_commands,
        );
    }
    if record.get("$set").is_some() {
        let set = &record["$set"];
        update_context(set, &mut cursor.context);
        if let Some(messages) = set.get("messages").and_then(Value::as_array) {
            return project_messages(
                Some(messages),
                cursor,
                started_utc,
                capture_prompts,
                capture_commands,
            );
        }
    }
    if let Some(message) = record.get("$patch").and_then(Value::as_object) {
        let updates = message
            .get("updates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten();
        let mut events = Vec::new();
        for update in updates {
            let message_id = update.get("id").and_then(Value::as_str).unwrap_or_default();
            for patch in update
                .get("toolCalls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let call_id = patch.get("id").and_then(Value::as_str).unwrap_or_default();
                if patch.get("result").is_none() {
                    continue;
                }
                if let Some((name, file_path, command)) = cursor.tool_calls.remove(call_id) {
                    let mut event = event(
                        &cursor.context,
                        EventKind::ToolFinished,
                        &format!("message:{message_id}:tool:{call_id}:finished"),
                    );
                    event.tool_name = Some(name);
                    event.file_path = file_path;
                    event.command = command;
                    events.push(event);
                }
            }
        }
        return events;
    }
    if record.get("id").is_some() && record.get("type").is_some() {
        return project_message(
            record,
            cursor,
            started_utc,
            capture_prompts,
            capture_commands,
        );
    }
    Vec::new()
}

fn update_context(record: &Value, context: &mut SessionContext) {
    if let Some(set) = record.get("$set") {
        update_context(set, context);
    }
    if let Some(id) = record.get("sessionId").and_then(Value::as_str) {
        context.session_id = id.to_owned();
    }
    if let Some(hash) = record.get("projectHash").and_then(Value::as_str) {
        context.project_hash = hash.to_owned();
    }
    if let Some(path) = record
        .get("directories")
        .and_then(Value::as_array)
        .and_then(|directories| directories.first())
        .and_then(Value::as_str)
    {
        context.project_path = Some(path.to_owned());
    }
}

fn project_messages(
    messages: Option<&Vec<Value>>,
    cursor: &mut Cursor,
    started_utc: DateTime<Utc>,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    messages
        .into_iter()
        .flatten()
        .flat_map(|message| {
            project_message(
                message,
                cursor,
                started_utc,
                capture_prompts,
                capture_commands,
            )
        })
        .collect()
}

fn remember_messages(snapshot: &Value, cursor: &mut Cursor) {
    update_context(snapshot, &mut cursor.context);
    if let Some(messages) = snapshot.get("messages").and_then(Value::as_array) {
        for message in messages {
            remember_fingerprint(message, cursor);
        }
    }
}

fn remember_fingerprint(message: &Value, cursor: &mut Cursor) -> Option<(String, bool)> {
    let id = message.get("id")?.as_str()?.to_owned();
    let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(message).ok()?));
    let changed = cursor.message_fingerprints.get(&id) != Some(&fingerprint);
    cursor.message_fingerprints.insert(id.clone(), fingerprint);
    Some((id, changed))
}

fn project_message(
    message: &Value,
    cursor: &mut Cursor,
    started_utc: DateTime<Utc>,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let Some((message_id, changed)) = remember_fingerprint(message, cursor) else {
        return Vec::new();
    };
    if !changed {
        return Vec::new();
    }
    let timestamp = message
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));
    if timestamp.is_some_and(|timestamp| timestamp < started_utc) {
        return Vec::new();
    }
    let kind = message
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut events = Vec::new();
    if kind == "user" {
        let mut event = event(
            &cursor.context,
            EventKind::UserMessage,
            &format!("message:{message_id}:user"),
        );
        event.occurred_at = timestamp.unwrap_or_else(Utc::now);
        if capture_prompts {
            event.content = text_content(message.get("content"));
        }
        events.push(event);
        return events;
    }
    if kind != "gemini" {
        return events;
    }
    let message_time = timestamp.unwrap_or_else(Utc::now);
    if let Some(tokens) = message.get("tokens") {
        let mut usage = event(
            &cursor.context,
            EventKind::ModelUsage,
            &format!("message:{message_id}:usage"),
        );
        usage.occurred_at = message_time;
        project_token_usage(tokens, &mut usage);
        usage.model = message
            .get("model")
            .and_then(Value::as_str)
            .map(provider_string);
        if usage.input_tokens.is_some() || usage.output_tokens.is_some() {
            events.push(usage);
        }
    }
    if let Some(tool_calls) = message.get("toolCalls").and_then(Value::as_array) {
        for call in tool_calls {
            let call_id = call.get("id").and_then(Value::as_str).unwrap_or_default();
            let name = call
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_owned();
            let args = call.get("args");
            let file_path = find_text(args, &["file_path", "path", "target_file"]);
            let command = capture_commands
                .then(|| find_text(args, &["command", "cmd", "script", "command_line"]))
                .flatten();
            let status = call
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (event_kind, suffix) = if status.to_lowercase().contains("error")
                || status.to_lowercase().contains("fail")
            {
                (EventKind::ToolFailed, "failed")
            } else if status.to_lowercase().contains("success")
                || status.to_lowercase().contains("complete")
            {
                (EventKind::ToolFinished, "finished")
            } else {
                (EventKind::ToolStarted, "started")
            };
            if !call_id.is_empty() && event_kind == EventKind::ToolStarted {
                cursor.tool_calls.insert(
                    call_id.to_owned(),
                    (name.clone(), file_path.clone(), command.clone()),
                );
            }
            let mut tool = event(
                &cursor.context,
                event_kind,
                &format!("message:{message_id}:tool:{call_id}:{suffix}"),
            );
            tool.occurred_at = call
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc))
                .unwrap_or(message_time);
            tool.tool_name = Some(name);
            tool.file_path = file_path;
            tool.command = command;
            tool.outcome = Some(status.to_owned()).filter(|status| !status.is_empty());
            events.push(tool);
        }
    }
    events
}

fn event(context: &SessionContext, kind: EventKind, key: &str) -> SessionEvent {
    let mut event = SessionEvent::new(&context.session_id, Provider::GeminiCli, kind);
    event.project_path = context.project_path.clone();
    event.project_hash = (!context.project_hash.is_empty()).then(|| context.project_hash.clone());
    event.event_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("gemini:{}:{key}", context.session_id).as_bytes(),
    );
    event
}

/// Gemini CLI copies the API `usageMetadata`: `input` (promptTokenCount)
/// includes the `cached` part, while `thoughts` (thoughtsTokenCount) and
/// `tool` (toolUsePromptTokenCount) are counted apart from `output` and
/// `input`. Thinking is billed as output and tool-use prompts as input, so
/// both are folded back in; values computed here are marked derived.
fn project_token_usage(tokens: &Value, usage: &mut SessionEvent) {
    let count = |key: &str| tokens.get(key).and_then(Value::as_u64);
    let cached = count("cached");
    let tool = count("tool").unwrap_or(0);
    usage.input_tokens = count("input").map(|input| {
        if cached.unwrap_or(0) == 0 && tool == 0 {
            return provider_value(input);
        }
        derived_value(input.saturating_sub(cached.unwrap_or(0)) + tool)
    });
    usage.cache_read_tokens = cached.map(provider_value);
    let thoughts = count("thoughts").unwrap_or(0);
    usage.output_tokens = count("output").map(|output| {
        if thoughts == 0 {
            provider_value(output)
        } else {
            derived_value(output + thoughts)
        }
    });
}

fn derived_value(value: u64) -> Sourced<u64> {
    Sourced {
        value,
        origin: DataOrigin::Derived,
    }
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

fn text_content(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(str::to_owned)
            .reduce(|mut all, text| {
                all.push('\n');
                all.push_str(&text);
                all
            }),
        _ => None,
    }
}

fn find_text(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let value = value?;
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

    fn cursor() -> Cursor {
        Cursor {
            offset: 0,
            pending: Vec::new(),
            context: SessionContext::default(),
            message_fingerprints: HashMap::new(),
            tool_calls: HashMap::new(),
            legacy_modified: None,
        }
    }

    #[test]
    fn cached_prompt_and_thinking_tokens_are_priced_apart() {
        let started = Utc::now() - Duration::seconds(1);
        let record = json!({
            "sessionId": "gemini-session",
            "messages": [{
                "id": "message-1", "type": "gemini", "timestamp": Utc::now().to_rfc3339(),
                "model": "gemini-2.5-pro",
                "tokens": { "input": 12000, "output": 300, "cached": 9000,
                    "thoughts": 700, "tool": 50, "total": 13050 }
            }]
        });
        let events = project_record(&record, &mut cursor(), started, false, false);
        let usage = events
            .iter()
            .find(|event| event.kind == EventKind::ModelUsage)
            .expect("Gemini provider usage observed");

        let input = usage.input_tokens.as_ref().unwrap();
        assert_eq!(input.value, 12000 - 9000 + 50);
        assert_eq!(input.origin, DataOrigin::Derived);
        assert_eq!(
            usage.cache_read_tokens.as_ref().map(|value| value.value),
            Some(9000)
        );
        let output = usage.output_tokens.as_ref().unwrap();
        assert_eq!(output.value, 300 + 700);
        assert_eq!(output.origin, DataOrigin::Derived);
    }

    #[test]
    fn captures_provider_usage_and_tool_lifecycle_but_not_tool_commands_by_default() {
        let started = Utc::now() - Duration::seconds(1);
        let record = json!({
            "sessionId": "gemini-session",
            "projectHash": "project-123",
            "messages": [{
                "id": "message-1", "type": "gemini", "timestamp": Utc::now().to_rfc3339(),
                "model": "gemini-test", "tokens": { "input": 90, "output": 17 },
                "toolCalls": [{ "id": "call-1", "name": "run_shell_command",
                    "status": "success", "args": { "command": "echo private", "path": "src/app.ts" }
                }]
            }]
        });
        let events = project_record(&record, &mut cursor(), started, false, false);

        let usage = events
            .iter()
            .find(|event| event.kind == EventKind::ModelUsage)
            .expect("Gemini provider usage observed");
        assert_eq!(
            usage.input_tokens.as_ref().map(|value| value.value),
            Some(90)
        );
        assert_eq!(
            usage.output_tokens.as_ref().map(|value| value.value),
            Some(17)
        );
        assert_eq!(
            usage.model.as_ref().map(|value| value.value.as_str()),
            Some("gemini-test")
        );
        assert_eq!(usage.project_hash.as_deref(), Some("project-123"));

        let tool = events
            .iter()
            .find(|event| event.kind == EventKind::ToolFinished)
            .expect("completed tool observed");
        assert_eq!(tool.file_path.as_deref(), Some("src/app.ts"));
        assert_eq!(tool.command, None);

        let captured = project_record(&record, &mut cursor(), started, false, true);
        assert_eq!(
            captured
                .iter()
                .find(|event| event.kind == EventKind::ToolFinished)
                .and_then(|event| event.command.as_deref()),
            Some("echo private")
        );
    }

    #[test]
    fn prompt_text_is_captured_only_when_explicitly_enabled() {
        let started = Utc::now() - Duration::seconds(1);
        let record = json!({ "messages": [{
            "id": "user-1", "type": "user", "timestamp": Utc::now().to_rfc3339(),
            "content": "private prompt"
        }] });
        let omitted = project_record(&record, &mut cursor(), started, false, false);
        let captured = project_record(&record, &mut cursor(), started, true, false);
        assert_eq!(omitted[0].content, None);
        assert_eq!(captured[0].content.as_deref(), Some("private prompt"));
    }
}
