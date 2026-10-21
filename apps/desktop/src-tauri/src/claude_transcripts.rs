//! Complements the Claude Code hooks with what only its session transcripts
//! (`~/.claude/projects/<project>/<session>.jsonl`) expose: provider-reported
//! token usage per model response, cache reads/writes included, and the start
//! of new sessions. Tool events keep coming from the hooks, so nothing is
//! counted twice. Only appended records are read; message text, thinking and
//! tool content are never persisted.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    thread,
    time::{Duration as StdDuration, SystemTime},
};
use uuid::Uuid;

const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
const POLL_INTERVAL: StdDuration = StdDuration::from_millis(1000);
const ACTIVE_FILE_WINDOW: Duration = Duration::hours(48);
const MAX_REMEMBERED_MESSAGES: usize = 20_000;
/// Stable ids: a usage event re-read after a restart updates the stored row instead of duplicating it.
const EVENT_NAMESPACE: Uuid = Uuid::from_u128(0x6f1d_2a7c_9b3e_4e55_8a10_c1a2_b3c4_d5e6);

#[derive(Default)]
struct SessionContext {
    id: String,
    project_path: Option<String>,
    started: bool,
    seen_messages: HashSet<String>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
}

pub struct TranscriptMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl TranscriptMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }

    pub fn poll(&mut self) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for (path, length) in recent_transcripts(&self.root) {
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
            if let Some(cursor) = self.cursors.get_mut(&path) {
                events.extend(read_appended_records(&path, cursor));
            }
        }
        events
    }
}

/// `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects` (`%USERPROFILE%` on Windows).
pub fn projects_root() -> PathBuf {
    if let Some(config) = env::var_os("CLAUDE_CONFIG_DIR") {
        return PathBuf::from(config).join("projects");
    }
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("projects")
}

pub fn spawn<F>(root: PathBuf, mut on_event: F)
where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = TranscriptMonitor::new(root);
        loop {
            for event in monitor.poll() {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

/// Main-session transcripts only: subagent transcripts live in subfolders and their usage already
/// reaches the observer through the hooks' `Agent` tool results.
fn recent_transcripts(root: &Path) -> Vec<(PathBuf, u64)> {
    let cutoff = Utc::now() - ACTIVE_FILE_WINDOW;
    let mut files = Vec::new();
    let Ok(projects) = fs::read_dir(root) else {
        return files;
    };
    for project in projects.flatten() {
        let Ok(entries) = fs::read_dir(project.path()) else {
            continue;
        };
        for entry in entries.flatten() {
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
        .unwrap_or("claude-session")
        .to_owned()
}

fn read_appended_records(path: &Path, cursor: &mut Cursor) -> Vec<SessionEvent> {
    let Ok(mut file) = fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(metadata) = file.metadata() else {
        return Vec::new();
    };
    if metadata.len() < cursor.offset {
        cursor.offset = 0;
        cursor.pending.clear();
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
            events.extend(project_record(&record, &mut cursor.context));
        }
        cursor.pending.drain(..=newline);
    }
    if cursor.pending.len() > MAX_LINE_BYTES {
        cursor.pending.clear();
    }
    events
}

fn project_record(record: &Value, context: &mut SessionContext) -> Vec<SessionEvent> {
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
        .map(|timestamp| timestamp.with_timezone(&Utc));
    let mut events = Vec::new();

    // The first timestamped record of a transcript created while the observer runs.
    if !context.started && occurred_at.is_some() && context.project_path.is_some() {
        context.started = true;
        let mut started =
            SessionEvent::new(&context.id, Provider::ClaudeCode, EventKind::SessionStarted);
        started.event_id = stable_id(&context.id, "session-started");
        started.occurred_at = occurred_at.unwrap_or_else(Utc::now);
        started.project_path = context.project_path.clone();
        events.push(started);
    }

    if record.get("type").and_then(Value::as_str) != Some("assistant")
        || record.get("isSidechain").and_then(Value::as_bool) == Some(true)
    {
        return events;
    }
    let Some(message) = record.get("message") else {
        return events;
    };
    let Some(usage) = message.get("usage") else {
        return events;
    };
    // A response is written once per content block, each copy repeating the same usage.
    let Some(message_id) = message.get("id").and_then(Value::as_str) else {
        return events;
    };
    if !context.seen_messages.insert(message_id.to_owned()) {
        return events;
    }
    if context.seen_messages.len() > MAX_REMEMBERED_MESSAGES {
        context.seen_messages.clear();
        context.seen_messages.insert(message_id.to_owned());
    }
    let model = message
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.starts_with('<'));
    let count = |key: &str| usage.get(key).and_then(Value::as_u64);
    let (input, output, cache_read, cache_write) = (
        count("input_tokens"),
        count("output_tokens"),
        count("cache_read_input_tokens"),
        count("cache_creation_input_tokens"),
    );
    if [input, output, cache_read, cache_write]
        .iter()
        .all(|value| value.unwrap_or(0) == 0)
    {
        return events;
    }
    let mut usage_event =
        SessionEvent::new(&context.id, Provider::ClaudeCode, EventKind::ModelUsage);
    usage_event.event_id = stable_id(&context.id, message_id);
    usage_event.occurred_at = occurred_at.unwrap_or_else(Utc::now);
    usage_event.project_path = context.project_path.clone();
    usage_event.model = model.map(|value| Sourced {
        value: value.to_owned(),
        origin: DataOrigin::Provider,
    });
    usage_event.input_tokens = input.map(provider_value);
    usage_event.output_tokens = output.map(provider_value);
    usage_event.cache_read_tokens = cache_read.map(provider_value);
    usage_event.cache_write_tokens = cache_write.map(provider_value);
    events.push(usage_event);
    events
}

fn stable_id(session_id: &str, key: &str) -> Uuid {
    Uuid::new_v5(
        &EVENT_NAMESPACE,
        format!("claude-transcript:{session_id}:{key}").as_bytes(),
    )
}

fn provider_value(value: u64) -> Sourced<u64> {
    Sourced {
        value,
        origin: DataOrigin::Provider,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn assistant(message_id: &str, extra: Value) -> Value {
        let mut record = json!({
            "type": "assistant", "sessionId": "claude-session", "cwd": "/work/demo",
            "timestamp": "2026-10-21T08:00:00.000Z",
            "message": { "id": message_id, "model": "claude-opus-5-5", "content": [{ "type": "text", "text": "must not be retained" }],
                "usage": { "input_tokens": 3, "output_tokens": 120, "cache_read_input_tokens": 50_000, "cache_creation_input_tokens": 900 } }
        });
        record
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        record
    }

    #[test]
    fn counts_each_response_once_with_cache_tokens_apart() {
        let mut context = SessionContext {
            started: true,
            ..SessionContext::default()
        };
        let first = project_record(&assistant("msg_1", json!({})), &mut context);
        let repeated = project_record(&assistant("msg_1", json!({})), &mut context);
        assert_eq!(first.len(), 1);
        assert!(repeated.is_empty());
        let usage = &first[0];
        assert_eq!(usage.kind, EventKind::ModelUsage);
        assert_eq!(usage.provider, Provider::ClaudeCode);
        assert_eq!(usage.session_id, "claude-session");
        assert_eq!(
            usage.input_tokens.as_ref().map(|value| value.value),
            Some(3)
        );
        assert_eq!(
            usage.output_tokens.as_ref().map(|value| value.value),
            Some(120)
        );
        assert_eq!(
            usage.cache_read_tokens.as_ref().map(|value| value.value),
            Some(50_000)
        );
        assert_eq!(
            usage.cache_write_tokens.as_ref().map(|value| value.value),
            Some(900)
        );
        assert_eq!(
            usage.model.as_ref().map(|value| value.value.as_str()),
            Some("claude-opus-5-5")
        );
        assert_eq!(usage.content, None);
        assert_eq!(usage.event_id, stable_id("claude-session", "msg_1"));
    }

    #[test]
    fn ignores_subagent_records_and_synthetic_empty_responses() {
        let mut context = SessionContext {
            started: true,
            ..SessionContext::default()
        };
        assert!(
            project_record(
                &assistant("msg_2", json!({ "isSidechain": true })),
                &mut context
            )
            .is_empty()
        );
        let synthetic = json!({ "type": "assistant", "sessionId": "s", "timestamp": "2026-10-21T08:00:00Z",
            "message": { "id": "msg_3", "model": "<synthetic>", "usage": { "input_tokens": 0, "output_tokens": 0 } } });
        assert!(project_record(&synthetic, &mut context).is_empty());
    }

    #[test]
    fn new_transcripts_start_a_session_once() {
        let root = env::temp_dir().join(format!("agent-observer-claude-{}", Uuid::new_v4()));
        let project = root.join("-work-demo");
        fs::create_dir_all(&project).unwrap();
        let mut monitor = TranscriptMonitor::new(root.clone());
        monitor.started_at = SystemTime::now() - StdDuration::from_secs(60);
        let path = project.join("claude-session.jsonl");
        let user = json!({ "type": "user", "sessionId": "claude-session", "cwd": "/work/demo", "timestamp": "2026-10-21T07:59:00Z", "message": { "content": "private prompt" } });
        fs::write(
            &path,
            format!("{user}\n{}\n", assistant("msg_4", json!({}))),
        )
        .unwrap();
        let events = monitor.poll();
        let again = monitor.poll();
        let _ = fs::remove_dir_all(&root);
        assert_eq!(
            events.iter().map(|event| event.kind).collect::<Vec<_>>(),
            vec![EventKind::SessionStarted, EventKind::ModelUsage]
        );
        assert_eq!(events[0].project_path.as_deref(), Some("/work/demo"));
        assert!(events.iter().all(|event| event.content.is_none()));
        assert!(again.is_empty());
    }
}
