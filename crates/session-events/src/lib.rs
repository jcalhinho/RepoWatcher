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
    OpenCode,
    GitHubCopilot,
    GeminiCli,
    Cline,
    RooCode,
    Continue,
    Aider,
}

impl Provider {
    pub const ALL: [Self; 10] = [
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
    pub kind: EventKind,
    pub project_path: Option<String>,
    pub project_hash: Option<String>,
    pub model: Option<Sourced<String>>,
    pub tool_name: Option<String>,
    pub command: Option<String>,
    pub file_path: Option<String>,
    pub input_tokens: Option<Sourced<u64>>,
    pub output_tokens: Option<Sourced<u64>>,
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
            kind,
            project_path: None,
            project_hash: None,
            model: None,
            tool_name: None,
            command: None,
            file_path: None,
            input_tokens: None,
            output_tokens: None,
            duration_ms: None,
            outcome: None,
            content: None,
        }
    }
}
