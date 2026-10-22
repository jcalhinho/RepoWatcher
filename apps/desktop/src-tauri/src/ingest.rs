//! The open local API: any agent, script or hook can send its events with
//! `POST http://127.0.0.1:43821/v1/events`, authenticated by the token of a
//! connector declared in the app. Documented in `docs/CONNECTORS.md`.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use uuid::Uuid;

pub const MAX_EVENTS_PER_REQUEST: usize = 500;
const NAMESPACE: Uuid = Uuid::from_u128(0x2b6f_9a41_0c3d_4f7e_9d21_77a0_c4e3_b5f1);
/// Colours for custom agents, after the five built-in ones (validated palette slots).
const COLORS: [&str; 3] = ["#c98500", "#008300", "#e66767"];

pub const TABLE: &str = "CREATE TABLE IF NOT EXISTS custom_connectors (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);";

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct CustomConnector {
    pub id: String,
    pub name: String,
    pub color: String,
    pub token: String,
}

/// One event as sent by a custom connector. Unknown fields are rejected so typos surface at once.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncomingEvent {
    pub session_id: String,
    pub kind: EventKind,
    #[serde(default)]
    pub event_id: Option<String>,
    #[serde(default)]
    pub occurred_at: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub input_tokens: Option<u64>,
    #[serde(default)]
    pub output_tokens: Option<u64>,
    #[serde(default)]
    pub cache_read_tokens: Option<u64>,
    #[serde(default)]
    pub cache_write_tokens: Option<u64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

fn slug(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "agent".into()
    } else {
        slug.chars().take(40).collect()
    }
}

pub fn list(connection: &Connection) -> rusqlite::Result<Vec<CustomConnector>> {
    let mut statement = connection
        .prepare("SELECT id, name, color, token FROM custom_connectors ORDER BY created_at")?;
    let rows = statement.query_map([], |row| {
        Ok(CustomConnector {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            token: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn create(connection: &Connection, name: &str) -> Result<CustomConnector, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err("Donne un nom de 1 à 40 caractères.".into());
    }
    let existing = list(connection).map_err(|error| error.to_string())?;
    let base = slug(name);
    let mut id = base.clone();
    let mut suffix = 2;
    while existing.iter().any(|connector| connector.id == id) {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }
    let color = COLORS
        .get(existing.len())
        .copied()
        .unwrap_or("#7d8aa3")
        .to_owned();
    let connector = CustomConnector {
        id,
        name: name.to_owned(),
        color,
        token: Uuid::new_v4().simple().to_string(),
    };
    connection
        .execute(
            "INSERT INTO custom_connectors (id, name, color, token, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![connector.id, connector.name, connector.color, connector.token, Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    Ok(connector)
}

pub fn delete(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM custom_connectors WHERE id = ?1", [id])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn connector_for_token(connection: &Connection, token: &str) -> Option<String> {
    connection
        .query_row(
            "SELECT id FROM custom_connectors WHERE token = ?1",
            [token],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
}

/// Parses a request body (one event or an array) into stored events, or explains what is wrong.
pub fn parse(
    body: &[u8],
    connector_id: &str,
    capture_prompts: bool,
    capture_commands: bool,
) -> Result<Vec<SessionEvent>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|error| format!("JSON invalide : {error}"))?;
    let items = match value {
        serde_json::Value::Array(items) => items,
        object @ serde_json::Value::Object(_) => vec![object],
        _ => return Err("Le corps doit être un événement JSON ou un tableau d’événements.".into()),
    };
    if items.is_empty() || items.len() > MAX_EVENTS_PER_REQUEST {
        return Err(format!(
            "Envoie entre 1 et {MAX_EVENTS_PER_REQUEST} événements par requête."
        ));
    }
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let incoming: IncomingEvent = serde_json::from_value(item)
                .map_err(|error| format!("Événement {index} : {error}"))?;
            to_event(incoming, connector_id, capture_prompts, capture_commands)
                .map_err(|error| format!("Événement {index} : {error}"))
        })
        .collect()
}

fn to_event(
    incoming: IncomingEvent,
    connector_id: &str,
    capture_prompts: bool,
    capture_commands: bool,
) -> Result<SessionEvent, String> {
    let session_id = incoming.session_id.trim();
    if session_id.is_empty() || session_id.len() > 200 {
        return Err("`session_id` doit faire de 1 à 200 caractères.".into());
    }
    let mut event = SessionEvent::new(session_id, Provider::Custom, incoming.kind);
    event.agent = Some(connector_id.to_owned());
    if let Some(at) = incoming.occurred_at {
        event.occurred_at = DateTime::parse_from_rfc3339(&at)
            .map_err(|_| format!("`occurred_at` n’est pas une date RFC 3339 : {at}"))?
            .with_timezone(&Utc);
    }
    // A sender-chosen id makes retries idempotent: the same id updates the same stored event.
    if let Some(id) = incoming.event_id.filter(|id| !id.is_empty()) {
        event.event_id = Uuid::new_v5(&NAMESPACE, format!("{connector_id}:{id}").as_bytes());
    }
    let sourced = |value: u64| Sourced {
        value,
        origin: DataOrigin::Provider,
    };
    event.project_path = incoming.project_path;
    event.tool_name = incoming.tool_name;
    event.file_path = incoming.file_path;
    event.command = incoming.command.filter(|_| capture_commands);
    event.content = incoming.content.filter(|_| capture_prompts);
    event.model = incoming.model.map(|value| Sourced {
        value,
        origin: DataOrigin::Provider,
    });
    event.outcome = incoming.outcome;
    event.input_tokens = incoming.input_tokens.map(sourced);
    event.output_tokens = incoming.output_tokens.map(sourced);
    event.cache_read_tokens = incoming.cache_read_tokens.map(sourced);
    event.cache_write_tokens = incoming.cache_write_tokens.map(sourced);
    event.duration_ms = incoming.duration_ms.map(sourced);
    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(TABLE).unwrap();
        connection
    }

    #[test]
    fn declares_connectors_with_unique_ids_tokens_and_colours() {
        let connection = database();
        let first = create(&connection, "Mon Agent !").unwrap();
        let second = create(&connection, "mon agent").unwrap();
        assert_eq!(first.id, "mon-agent");
        assert_eq!(second.id, "mon-agent-2");
        assert_ne!(first.token, second.token);
        assert_ne!(first.color, second.color);
        assert_eq!(
            connector_for_token(&connection, &second.token).as_deref(),
            Some("mon-agent-2")
        );
        delete(&connection, "mon-agent").unwrap();
        assert_eq!(connector_for_token(&connection, &first.token), None);
        assert!(create(&connection, "  ").is_err());
    }

    #[test]
    fn parses_one_event_or_a_batch_and_applies_capture_policy() {
        let body = br#"[
            {"session_id": "s1", "kind": "tool_started", "tool_name": "bash", "command": "make test", "event_id": "a1"},
            {"session_id": "s1", "kind": "model_usage", "model": "my-model", "input_tokens": 120, "output_tokens": 30, "occurred_at": "2026-10-21T10:00:00Z"},
            {"session_id": "s1", "kind": "user_message", "content": "secret prompt"}
        ]"#;
        let events = parse(body, "my-agent", false, false).unwrap();
        assert_eq!(events.len(), 3);
        assert!(events.iter().all(|event| event.provider == Provider::Custom
            && event.agent.as_deref() == Some("my-agent")));
        assert_eq!(events[0].command, None);
        assert_eq!(events[2].content, None);
        assert_eq!(
            events[1].input_tokens.as_ref().map(|value| value.value),
            Some(120)
        );
        assert_eq!(
            events[0].event_id,
            parse(body, "my-agent", false, false).unwrap()[0].event_id
        );
        assert_eq!(
            parse(
                br#"{"session_id": "s", "kind": "user_message", "content": "kept"}"#,
                "a",
                true,
                false
            )
            .unwrap()[0]
                .content
                .as_deref(),
            Some("kept")
        );
    }

    #[test]
    fn explains_what_is_wrong() {
        assert!(
            parse(b"nope", "a", false, false)
                .unwrap_err()
                .contains("JSON invalide")
        );
        assert!(
            parse(
                br#"{"session_id": "s", "kind": "dancing"}"#,
                "a",
                false,
                false
            )
            .unwrap_err()
            .contains("Événement 0")
        );
        assert!(
            parse(
                br#"{"session_id": "s", "kind": "checkpoint", "tokens": 3}"#,
                "a",
                false,
                false
            )
            .unwrap_err()
            .contains("tokens")
        );
        assert!(
            parse(
                br#"{"session_id": "s", "kind": "checkpoint", "occurred_at": "hier"}"#,
                "a",
                false,
                false
            )
            .unwrap_err()
            .contains("RFC 3339")
        );
        assert!(parse(b"[]", "a", false, false).is_err());
    }
}
