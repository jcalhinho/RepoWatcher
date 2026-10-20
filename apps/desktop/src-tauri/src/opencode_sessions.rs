//! Reads newly written OpenCode SQLite session messages in read-only mode.
//! Prompt and shell-command text follow the shared opt-in capture policy;
//! assistant text, reasoning, and tool results are never persisted.

use chrono::Utc;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use uuid::Uuid;

const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Default)]
struct SessionInfo {
    directory: Option<String>,
}

pub struct OpenCodeMonitor {
    started_at_ms: i64,
    seen_messages: HashMap<(PathBuf, String), String>,
    active_tools: HashSet<(PathBuf, String)>,
}

impl OpenCodeMonitor {
    pub fn new() -> Self {
        Self {
            started_at_ms: Utc::now().timestamp_millis(),
            seen_messages: HashMap::new(),
            active_tools: HashSet::new(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for path in database_paths() {
            let Ok(connection) = Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) else {
                continue;
            };
            let _ = connection.busy_timeout(BUSY_TIMEOUT);
            if !has_table(&connection, "session_message") || !has_table(&connection, "session_v2") {
                continue;
            }
            let Ok(mut statement) = connection.prepare(
                "SELECT m.session_id, m.id, m.type, m.time_created, m.time_updated, m.data, s.directory FROM session_message m LEFT JOIN session_v2 s ON s.id = m.session_id WHERE m.time_created >= ?1 OR m.time_updated >= ?1 ORDER BY m.time_created, m.id",
            ) else {
                continue;
            };
            let Ok(rows) = statement.query_map(params![self.started_at_ms], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            }) else {
                continue;
            };
            for row in rows.flatten() {
                let (session_id, message_id, kind, created_ms, updated_ms, data, directory) = row;
                let Ok(record) = serde_json::from_str::<Value>(&data) else {
                    continue;
                };
                let digest = Sha256::digest(data.as_bytes());
                let fingerprint = format!("{updated_ms}:{kind}:{digest:x}");
                let key = (path.clone(), message_id.clone());
                if self.seen_messages.get(&key) == Some(&fingerprint) {
                    continue;
                }
                self.seen_messages.insert(key, fingerprint);
                let context = SessionInfo { directory };
                let occurred_at =
                    chrono::DateTime::from_timestamp_millis(created_ms).unwrap_or_else(Utc::now);
                match kind.as_str() {
                    "user" => {
                        let mut event = make_event(
                            &path,
                            &session_id,
                            EventKind::UserMessage,
                            &format!("{message_id}:user"),
                            &context,
                        );
                        event.occurred_at = occurred_at;
                        if capture_prompts {
                            event.content = record
                                .get("text")
                                .and_then(Value::as_str)
                                .map(str::to_owned);
                        }
                        events.push(event);
                    }
                    "assistant" => {
                        let usage_timestamp_ms = record
                            .get("time")
                            .and_then(|time| time.get("completed"))
                            .and_then(Value::as_i64)
                            .unwrap_or(updated_ms);
                        let message_model = record
                            .get("model")
                            .and_then(|model| model.get("id").or_else(|| model.get("modelID")))
                            .and_then(Value::as_str);
                        if let Some(tokens) = record.get("tokens") {
                            let mut usage = make_event(
                                &path,
                                &session_id,
                                EventKind::ModelUsage,
                                &format!("{message_id}:usage"),
                                &context,
                            );
                            usage.occurred_at =
                                chrono::DateTime::from_timestamp_millis(usage_timestamp_ms)
                                    .unwrap_or(occurred_at);
                            usage.input_tokens = tokens
                                .get("input")
                                .and_then(Value::as_u64)
                                .map(provider_value);
                            usage.output_tokens = tokens
                                .get("output")
                                .and_then(Value::as_u64)
                                .map(provider_value);
                            usage.model = message_model.map(provider_string);
                            if usage.input_tokens.is_some() || usage.output_tokens.is_some() {
                                events.push(usage);
                            }
                        }
                        if let Some(parts) = record.get("content").and_then(Value::as_array) {
                            for part in parts.iter().filter(|part| {
                                part.get("type").and_then(Value::as_str) == Some("tool")
                            }) {
                                let call_id = part
                                    .get("id")
                                    .or_else(|| part.get("callID"))
                                    .and_then(Value::as_str)
                                    .unwrap_or_default();
                                let name = part
                                    .get("name")
                                    .or_else(|| part.get("tool"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("tool");
                                let state = part.get("state").unwrap_or(&Value::Null);
                                let status = state
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default();
                                let tool_time = part.get("time");
                                let started_ms = tool_time
                                    .and_then(|time| {
                                        time.get("ran").or_else(|| time.get("created"))
                                    })
                                    .and_then(Value::as_i64)
                                    .unwrap_or(updated_ms);
                                let completed_ms = tool_time
                                    .and_then(|time| time.get("completed"))
                                    .and_then(Value::as_i64)
                                    .unwrap_or(updated_ms);
                                let input = state.get("input");
                                let file_path =
                                    find_text(input, &["file_path", "path", "target_file"]);
                                let command = capture_commands
                                    .then(|| {
                                        find_text(
                                            input,
                                            &["command", "cmd", "script", "command_line"],
                                        )
                                    })
                                    .flatten();
                                let tool_key = (path.clone(), call_id.to_owned());
                                match status {
                                    "running" | "streaming" => {
                                        if self.active_tools.insert(tool_key) {
                                            events.push(make_tool_event(
                                                &path,
                                                &session_id,
                                                &context,
                                                &message_id,
                                                call_id,
                                                name,
                                                file_path,
                                                command,
                                                EventKind::ToolStarted,
                                                "started",
                                                started_ms,
                                                "running",
                                            ));
                                        }
                                    }
                                    "completed" => {
                                        if !self.active_tools.remove(&tool_key) {
                                            events.push(make_tool_event(
                                                &path,
                                                &session_id,
                                                &context,
                                                &message_id,
                                                call_id,
                                                name,
                                                file_path.clone(),
                                                command.clone(),
                                                EventKind::ToolStarted,
                                                "started",
                                                started_ms,
                                                "running",
                                            ));
                                        }
                                        events.push(make_tool_event(
                                            &path,
                                            &session_id,
                                            &context,
                                            &message_id,
                                            call_id,
                                            name,
                                            file_path,
                                            command,
                                            EventKind::ToolFinished,
                                            "finished",
                                            completed_ms,
                                            status,
                                        ));
                                    }
                                    "error" => {
                                        if !self.active_tools.remove(&tool_key) {
                                            events.push(make_tool_event(
                                                &path,
                                                &session_id,
                                                &context,
                                                &message_id,
                                                call_id,
                                                name,
                                                file_path.clone(),
                                                command.clone(),
                                                EventKind::ToolStarted,
                                                "started",
                                                started_ms,
                                                "running",
                                            ));
                                        }
                                        events.push(make_tool_event(
                                            &path,
                                            &session_id,
                                            &context,
                                            &message_id,
                                            call_id,
                                            name,
                                            file_path,
                                            command,
                                            EventKind::ToolFailed,
                                            "failed",
                                            completed_ms,
                                            status,
                                        ));
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        events
    }
}

pub fn data_root() -> PathBuf {
    if let Some(path) = env::var_os("OPENCODE_DATA_DIR") {
        return PathBuf::from(path);
    }
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let data_home = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| home.map(|path| path.join(".local").join("share")));
    data_home
        .unwrap_or_else(|| PathBuf::from("."))
        .join("opencode")
}

pub fn database_paths() -> Vec<PathBuf> {
    if let Some(path) = env::var_os("OPENCODE_DB") {
        return vec![PathBuf::from(path)];
    }
    let root = data_root();
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let filename = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if entry.file_type().is_ok_and(|kind| kind.is_file())
                && filename.starts_with("opencode")
                && filename.ends_with(".db")
            {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths
}

pub fn spawn<F>(
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
    mut on_event: F,
) where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = OpenCodeMonitor::new();
        loop {
            for event in monitor.poll(
                capture_prompts.load(Ordering::Relaxed),
                capture_commands.load(Ordering::Relaxed),
            ) {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn has_table(connection: &Connection, table: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |_| Ok(()),
        )
        .is_ok()
}

fn make_event(
    path: &Path,
    session_id: &str,
    kind: EventKind,
    key: &str,
    context: &SessionInfo,
) -> SessionEvent {
    let mut event = SessionEvent::new(session_id, Provider::OpenCode, kind);
    event.project_path = context.directory.clone();
    event.event_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("opencode:{}:{session_id}:{key}", path.display()).as_bytes(),
    );
    event
}

fn make_tool_event(
    path: &Path,
    session_id: &str,
    context: &SessionInfo,
    message_id: &str,
    call_id: &str,
    name: &str,
    file_path: Option<String>,
    command: Option<String>,
    kind: EventKind,
    suffix: &str,
    timestamp_ms: i64,
    outcome: &str,
) -> SessionEvent {
    let mut event = make_event(
        path,
        session_id,
        kind,
        &format!("{message_id}:tool:{call_id}:{suffix}"),
        context,
    );
    event.occurred_at =
        chrono::DateTime::from_timestamp_millis(timestamp_ms).unwrap_or_else(Utc::now);
    event.tool_name = Some(name.to_owned());
    event.file_path = file_path;
    event.command = command;
    event.outcome = Some(outcome.to_owned());
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
