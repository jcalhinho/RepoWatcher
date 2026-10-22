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
const POLL_OVERLAP_MS: i64 = 2_000;

#[derive(Default)]
struct SessionInfo {
    directory: Option<String>,
}

pub struct OpenCodeMonitor {
    started_at_ms: i64,
    last_poll_ms: HashMap<PathBuf, i64>,
    seen_messages: HashMap<(PathBuf, String), String>,
    active_tools: HashSet<(PathBuf, String)>,
}

impl OpenCodeMonitor {
    pub fn new() -> Self {
        Self {
            started_at_ms: Utc::now().timestamp_millis(),
            last_poll_ms: HashMap::new(),
            seen_messages: HashMap::new(),
            active_tools: HashSet::new(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        self.poll_paths(database_paths(), capture_prompts, capture_commands)
    }

    fn poll_paths(
        &mut self,
        paths: Vec<PathBuf>,
        capture_prompts: bool,
        capture_commands: bool,
    ) -> Vec<SessionEvent> {
        self.poll_paths_at(
            paths,
            capture_prompts,
            capture_commands,
            Utc::now().timestamp_millis(),
        )
    }

    fn poll_paths_at(
        &mut self,
        paths: Vec<PathBuf>,
        capture_prompts: bool,
        capture_commands: bool,
        now_ms: i64,
    ) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for path in paths {
            let since_ms = self
                .last_poll_ms
                .get(&path)
                .map(|last_poll| last_poll.saturating_sub(POLL_OVERLAP_MS))
                .unwrap_or(self.started_at_ms);
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
                "SELECT m.session_id, m.id, m.type, m.time_created, m.time_updated, m.data, s.directory FROM session_message m LEFT JOIN session_v2 s ON s.id = m.session_id WHERE m.time_created >= ?1 OR m.time_updated >= ?2 ORDER BY m.time_created, m.id",
            ) else {
                continue;
            };
            let Ok(rows) = statement.query_map(params![since_ms, since_ms], |row| {
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
                            project_token_usage(tokens, &mut usage);
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
            self.last_poll_ms.insert(path.clone(), now_ms);
            self.seen_messages.retain(|(db_path, _), fingerprint| {
                db_path != &path
                    || fingerprint
                        .split(':')
                        .next()
                        .and_then(|ts| ts.parse::<i64>().ok())
                        .is_some_and(|updated| {
                            updated >= now_ms.saturating_sub(POLL_OVERLAP_MS * 2)
                        })
            });
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

#[allow(clippy::too_many_arguments)]
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

/// OpenCode stores `input` without the cache (`cache.read` / `cache.write`
/// are apart) and `output` without `reasoning`; its own cost formula bills
/// `output + reasoning` at the output rate, so they are added (derived).
fn project_token_usage(tokens: &Value, usage: &mut SessionEvent) {
    let count = |value: Option<&Value>| value.and_then(Value::as_u64);
    usage.input_tokens = count(tokens.get("input")).map(provider_value);
    let cache = tokens.get("cache");
    usage.cache_read_tokens = count(cache.and_then(|cache| cache.get("read"))).map(provider_value);
    usage.cache_write_tokens =
        count(cache.and_then(|cache| cache.get("write"))).map(provider_value);
    let reasoning = count(tokens.get("reasoning")).unwrap_or(0);
    usage.output_tokens = count(tokens.get("output")).map(|output| {
        if reasoning == 0 {
            provider_value(output)
        } else {
            Sourced {
                value: output + reasoning,
                origin: DataOrigin::Derived,
            }
        }
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_database() -> PathBuf {
        let path = env::temp_dir().join(format!("agent-observer-opencode-{}.db", Uuid::new_v4()));
        let connection = Connection::open(&path).expect("create fixture database");
        connection
            .execute_batch(
                "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
                 CREATE TABLE session_message (
                   session_id TEXT NOT NULL, id TEXT PRIMARY KEY, type TEXT NOT NULL,
                   time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
                 );
                 INSERT INTO session_v2 (id, directory) VALUES ('ses-test', 'C:/work/demo');
                 INSERT INTO session_message VALUES
                   ('ses-test', 'msg-user', 'user', 1000, 1000,
                    '{\"text\":\"private prompt\"}'),
                   ('ses-test', 'msg-assistant', 'assistant', 1100, 1200,
                    '{\"model\":{\"id\":\"model-x\"},\"tokens\":{\"input\":123,\"output\":45},\"time\":{\"completed\":1200},\"content\":[{\"type\":\"tool\",\"id\":\"call-1\",\"name\":\"bash\",\"time\":{\"ran\":1150,\"completed\":1190},\"state\":{\"status\":\"completed\",\"input\":{\"command\":\"echo private\",\"path\":\"src/main.rs\"}}}]}');",
            )
            .expect("create OpenCode schema fixture");
        drop(connection);
        path
    }

    #[test]
    fn cache_and_reasoning_tokens_are_kept_apart_from_input() {
        let tokens = serde_json::json!({
            "input": 3641, "output": 976, "reasoning": 609,
            "cache": { "read": 81422, "write": 12 }
        });
        let mut usage = SessionEvent::new("ses", Provider::OpenCode, EventKind::ModelUsage);
        project_token_usage(&tokens, &mut usage);

        assert_eq!(
            usage.input_tokens.as_ref().map(|value| value.value),
            Some(3641)
        );
        assert_eq!(
            usage.cache_read_tokens.as_ref().map(|value| value.value),
            Some(81422)
        );
        assert_eq!(
            usage.cache_write_tokens.as_ref().map(|value| value.value),
            Some(12)
        );
        let output = usage.output_tokens.unwrap();
        assert_eq!(output.value, 976 + 609);
        assert_eq!(output.origin, DataOrigin::Derived);
    }

    #[test]
    fn polls_sqlite_events_without_retaining_sensitive_text_by_default() {
        let path = sample_database();
        let mut monitor = OpenCodeMonitor {
            started_at_ms: 0,
            last_poll_ms: HashMap::new(),
            ..OpenCodeMonitor::new()
        };
        let events = monitor.poll_paths(vec![path.clone()], false, false);
        let _ = fs::remove_file(&path);

        let user = events
            .iter()
            .find(|event| event.kind == EventKind::UserMessage)
            .expect("user message observed");
        assert_eq!(user.session_id, "ses-test");
        assert_eq!(user.project_path.as_deref(), Some("C:/work/demo"));
        assert_eq!(user.content, None);

        let usage = events
            .iter()
            .find(|event| event.kind == EventKind::ModelUsage)
            .expect("provider token usage observed");
        assert_eq!(
            usage.model.as_ref().map(|value| value.value.as_str()),
            Some("model-x")
        );
        assert_eq!(
            usage.input_tokens.as_ref().map(|value| value.value),
            Some(123)
        );
        assert_eq!(
            usage.output_tokens.as_ref().map(|value| value.value),
            Some(45)
        );

        let tool_events: Vec<_> = events
            .iter()
            .filter(|event| matches!(event.kind, EventKind::ToolStarted | EventKind::ToolFinished))
            .collect();
        assert_eq!(
            tool_events.len(),
            2,
            "completed tools get a visible start and finish"
        );
        assert_eq!(tool_events[0].kind, EventKind::ToolStarted);
        assert_eq!(tool_events[1].kind, EventKind::ToolFinished);
        assert!(tool_events.iter().all(|event| event.command.is_none()));
        assert!(
            tool_events
                .iter()
                .all(|event| event.file_path.as_deref() == Some("src/main.rs"))
        );
    }

    #[test]
    fn command_capture_is_opt_in_for_opencode_tools() {
        let path = sample_database();
        let mut monitor = OpenCodeMonitor {
            started_at_ms: 0,
            last_poll_ms: HashMap::new(),
            ..OpenCodeMonitor::new()
        };
        let events = monitor.poll_paths(vec![path.clone()], false, true);
        let _ = fs::remove_file(&path);
        let tool = events
            .iter()
            .find(|event| event.kind == EventKind::ToolFinished)
            .expect("tool completion observed");
        assert_eq!(tool.command.as_deref(), Some("echo private"));
    }

    #[test]
    fn polling_prunes_old_message_fingerprints() {
        let path = sample_database();
        let connection = Connection::open(&path).expect("open fixture database");
        connection
            .execute("DELETE FROM session_message", [])
            .expect("clear fixture messages");
        let mut monitor = OpenCodeMonitor {
            started_at_ms: 0,
            last_poll_ms: HashMap::new(),
            ..OpenCodeMonitor::new()
        };
        let mut emitted = 0;

        for index in 0..20 {
            let timestamp = 2_000 + index * 2_000;
            connection
                .execute(
                    "INSERT INTO session_message VALUES (?1, ?2, 'user', ?3, ?3, ?4)",
                    params![
                        "ses-test",
                        format!("msg-{index}"),
                        timestamp,
                        format!("{{\"text\":\"message {index}\"}}")
                    ],
                )
                .expect("insert fixture message");
            emitted += monitor
                .poll_paths_at(vec![path.clone()], false, false, timestamp)
                .len();
        }

        assert!(
            monitor.seen_messages.len() <= 3,
            "dedup cache grew to {} rows",
            monitor.seen_messages.len()
        );
        assert_eq!(emitted, 20, "old messages were emitted more than once");
        let _ = fs::remove_file(&path);
    }
}
