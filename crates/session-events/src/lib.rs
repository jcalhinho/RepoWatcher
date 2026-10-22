//! Shared, provider-neutral event model for local coding-agent sessions.
//!
//! Keep observed data distinct from locally derived or estimated values. A
//! connector should omit fields it cannot actually observe rather than infer
//! them silently.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const EVENT_SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    ClaudeCode,
    Codex,
    Cursor,
    // Serialized names must match `key()`, which the UI and the SQLite
    // `provider` column use. Aliases keep events stored before this rename
    // readable.
    #[serde(rename = "opencode", alias = "open_code")]
    OpenCode,
    #[serde(rename = "github_copilot", alias = "git_hub_copilot")]
    GitHubCopilot,
    GeminiCli,
    Cline,
    RooCode,
    Continue,
    Aider,
    QwenCode,
    /// An agent sending its events through the open HTTP API; `SessionEvent.agent` names it.
    Custom,
}

impl Provider {
    pub const ALL: [Self; 12] = [
        Self::ClaudeCode,
        Self::Codex,
        Self::Cursor,
        Self::OpenCode,
        Self::GitHubCopilot,
        Self::GeminiCli,
        Self::Cline,
        Self::RooCode,
        Self::Continue,
        Self::Aider,
        Self::QwenCode,
        Self::Custom,
    ];

    pub const fn key(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude_code",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
            Self::GitHubCopilot => "github_copilot",
            Self::GeminiCli => "gemini_cli",
            Self::Cline => "cline",
            Self::RooCode => "roo_code",
            Self::Continue => "continue",
            Self::Aider => "aider",
            Self::QwenCode => "qwen_code",
            Self::Custom => "custom",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    SessionStarted,
    SessionEnded,
    UserMessage,
    AssistantMessage,
    ToolStarted,
    ToolFinished,
    ToolFailed,
    FileRead,
    FileChanged,
    ModelUsage,
    Checkpoint,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DataOrigin {
    Provider,
    LocalObservation,
    Derived,
    Estimated,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Sourced<T> {
    pub value: T,
    pub origin: DataOrigin,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct TokenUsage {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SessionEvent {
    pub schema_version: u16,
    pub event_id: Uuid,
    pub session_id: String,
    pub occurred_at: DateTime<Utc>,
    pub provider: Provider,
    /// Identifier of the custom connector that sent the event (`Provider::Custom` only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    pub kind: EventKind,
    pub project_path: Option<String>,
    pub project_hash: Option<String>,
    pub model: Option<Sourced<String>>,
    pub tool_name: Option<String>,
    pub command: Option<String>,
    pub file_path: Option<String>,
    pub input_tokens: Option<Sourced<u64>>,
    pub output_tokens: Option<Sourced<u64>>,
    /// Prompt tokens served from the provider's cache, reported apart from
    /// `input_tokens` (which then counts uncached input only). Absent in
    /// events recorded before these fields existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<Sourced<u64>>,
    /// Prompt tokens written to the provider's cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<Sourced<u64>>,
    pub duration_ms: Option<Sourced<u64>>,
    pub outcome: Option<String>,
    /// Human-readable content is optional so installations can collect
    /// operational metadata without retaining prompts or tool output.
    pub content: Option<String>,
}

impl SessionEvent {
    pub fn new(session_id: impl Into<String>, provider: Provider, kind: EventKind) -> Self {
        Self {
            schema_version: EVENT_SCHEMA_VERSION,
            event_id: Uuid::new_v4(),
            session_id: session_id.into(),
            occurred_at: Utc::now(),
            provider,
            agent: None,
            kind,
            project_path: None,
            project_hash: None,
            model: None,
            tool_name: None,
            command: None,
            file_path: None,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            duration_ms: None,
            outcome: None,
            content: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_provider_matches_key() {
        for provider in Provider::ALL {
            let serialized = serde_json::to_string(&provider).unwrap();
            assert_eq!(serialized, format!("\"{}\"", provider.key()));
            let parsed: Provider = serde_json::from_str(&serialized).unwrap();
            assert_eq!(parsed, provider);
        }
    }

    #[test]
    fn events_without_cache_fields_still_deserialize() {
        let mut event = SessionEvent::new("s", Provider::ClaudeCode, EventKind::ModelUsage);
        event.cache_read_tokens = Some(Sourced {
            value: 7,
            origin: DataOrigin::Provider,
        });
        let mut json: serde_json::Value = serde_json::to_value(&event).unwrap();
        json.as_object_mut().unwrap().remove("cache_read_tokens");
        let parsed: SessionEvent = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.cache_read_tokens, None);
        assert!(
            !serde_json::to_string(&parsed)
                .unwrap()
                .contains("cache_write_tokens")
        );
    }

    #[test]
    fn legacy_provider_names_still_deserialize() {
        let opencode: Provider = serde_json::from_str("\"open_code\"").unwrap();
        let copilot: Provider = serde_json::from_str("\"git_hub_copilot\"").unwrap();
        assert_eq!(opencode, Provider::OpenCode);
        assert_eq!(copilot, Provider::GitHubCopilot);
    }
}
