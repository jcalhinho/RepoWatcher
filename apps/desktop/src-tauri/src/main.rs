#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod codex_rollout;
mod gemini_sessions;
mod opencode_sessions;
mod qwen_sessions;

use axum::{
    Router,
    extract::{Request, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::post,
};
use rusqlite::OptionalExtension;
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufWriter, Write},
    net::SocketAddr,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use uuid::Uuid;

#[derive(Clone)]
struct CollectorState {
    app: tauri::AppHandle,
    token: String,
    database: Arc<Mutex<Connection>>,
    status: Arc<Mutex<String>>,
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
}

#[derive(Serialize)]
struct ClaudeSetup {
    endpoint: String,
    token: String,
    settings_fragment: String,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct CodexSetup {
    sessions_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct GeminiSetup {
    sessions_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct QwenSetup {
    projects_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct OpenCodeSetup {
    data_dir: String,
    database_paths: Vec<String>,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct CursorSetup {
    endpoint: String,
    settings_fragment: String,
    capture_commands: bool,
}

#[derive(Serialize)]
struct RepositorySnapshot {
    root: String,
    project_hash: String,
    branch: Option<String>,
    changed_files: Vec<RepositoryFile>,
    recent_commits: Vec<RepositoryCommit>,
}

#[derive(Serialize)]
struct RepositoryFile {
    path: String,
    status: String,
}

#[derive(Serialize)]
struct RepositoryCommit {
    short_id: String,
    subject: String,
    relative_time: String,
}

#[derive(Debug, PartialEq, Serialize)]
struct WindowCommit {
    id: String,
    short_id: String,
    subject: String,
    author: String,
    committed_at: String,
}

#[derive(Serialize)]
struct WindowCommits {
    commits: Vec<WindowCommit>,
    truncated: bool,
}

const WINDOW_COMMIT_LIMIT: usize = 100;

#[tauri::command]
fn claude_setup(state: tauri::State<'_, CollectorState>) -> ClaudeSetup {
    let endpoint = "http://127.0.0.1:43821/claude-hook".to_owned();
    let hook = || json!([{ "hooks": [{ "type": "http", "url": endpoint, "timeout": 2, "headers": { "Authorization": format!("Bearer {}", state.token) } }] }]);
    let fragment = json!({ "hooks": {
        "UserPromptSubmit": hook(),
        "PreToolUse": hook(),
        "PostToolUse": hook(),
        "PostToolUseFailure": hook(),
        "Stop": hook(),
        "SessionEnd": hook()
    }});
    ClaudeSetup {
        endpoint,
        token: state.token.clone(),
        settings_fragment: serde_json::to_string_pretty(&fragment).unwrap_or_default(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn codex_setup(state: tauri::State<'_, CollectorState>) -> CodexSetup {
    let sessions_dir = codex_rollout::sessions_root();
    CodexSetup {
        sessions_dir: sessions_dir.display().to_string(),
        available: sessions_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn gemini_setup(state: tauri::State<'_, CollectorState>) -> GeminiSetup {
    let sessions_dir = gemini_sessions::sessions_root();
    GeminiSetup {
        sessions_dir: sessions_dir.display().to_string(),
        available: sessions_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn qwen_setup(state: tauri::State<'_, CollectorState>) -> QwenSetup {
    let projects_dir = qwen_sessions::projects_root();
    QwenSetup {
        projects_dir: projects_dir.display().to_string(),
        available: projects_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn opencode_setup(state: tauri::State<'_, CollectorState>) -> OpenCodeSetup {
    let paths = opencode_sessions::database_paths();
    OpenCodeSetup {
        data_dir: opencode_sessions::data_root().display().to_string(),
        database_paths: paths
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
        available: !paths.is_empty(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn cursor_setup(
    state: tauri::State<'_, CollectorState>,
    app: tauri::AppHandle,
) -> Result<CursorSetup, String> {
    let endpoint = "http://127.0.0.1:43821/cursor-hook";
    let token_path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("collector-token");
    let command = if cfg!(target_os = "windows") {
        let path = token_path.display().to_string().replace('\'', "''");
        format!(
            r#"powershell.exe -NoProfile -NonInteractive -Command "[Console]::InputEncoding=[System.Text.UTF8Encoding]::new(); $p=[Console]::In.ReadToEnd(); $t=(Get-Content -Raw -LiteralPath '{}').Trim(); try {{ Invoke-RestMethod -Uri '{}' -Method Post -ContentType 'application/json' -Headers @{{Authorization=('Bearer '+$t)}} -Body $p | Out-Null }} catch {{ }}"#,
            path, endpoint
        )
    } else {
        let path = serde_json::to_string(&token_path.display().to_string())
            .map_err(|error| error.to_string())?;
        let python = format!(
            "import sys,json,urllib.request; p=sys.stdin.read(); t=open({path},encoding='utf-8').read().strip(); r=urllib.request.Request('{endpoint}',data=p.encode(),headers={{'Content-Type':'application/json','Authorization':'Bearer '+t}},method='POST'); urllib.request.urlopen(r,timeout=2).read()",
            path = path,
            endpoint = endpoint
        );
        format!(
            // Like the PowerShell `catch {}`: never fail the Cursor hook when the
            // observer is closed or python3 is missing.
            "python3 -c {} >/dev/null 2>&1 || true",
            serde_json::to_string(&python).map_err(|error| error.to_string())?
        )
    };
    let hook = json!([{ "command": command, "timeout": 3 }]);
    let fragment = json!({ "version": 1, "hooks": {
        "sessionStart": hook,
        "sessionEnd": hook,
        "postToolUse": hook,
        "postToolUseFailure": hook,
        "afterShellExecution": hook,
        "afterFileEdit": hook,
        "stop": hook
    }});
    Ok(CursorSetup {
        endpoint: endpoint.to_owned(),
        settings_fragment: serde_json::to_string_pretty(&fragment).unwrap_or_default(),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    })
}

#[tauri::command]
fn update_capture_policy(
    state: tauri::State<'_, CollectorState>,
    capture_prompts: bool,
    capture_commands: bool,
) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database.execute("INSERT INTO preferences(key, value) VALUES ('capture_prompts', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [capture_prompts as i64]).map_err(|error| error.to_string())?;
    database.execute("INSERT INTO preferences(key, value) VALUES ('capture_commands', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [capture_commands as i64]).map_err(|error| error.to_string())?;
    state
        .capture_prompts
        .store(capture_prompts, Ordering::Relaxed);
    state
        .capture_commands
        .store(capture_commands, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn clear_session_history(state: tauri::State<'_, CollectorState>) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM session_events", [])
        .map_err(|error| error.to_string())?;
    database
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_session_events(
    state: tauri::State<'_, CollectorState>,
    limit: Option<usize>,
    before_occurred_at: Option<String>,
    before_event_id: Option<String>,
) -> Result<Vec<SessionEvent>, String> {
    let limit = limit.unwrap_or(500).clamp(1, 500) as i64;
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT payload FROM session_events WHERE (?1 IS NULL OR (occurred_at, event_id) < (?1, ?2)) ORDER BY occurred_at DESC, event_id DESC LIMIT ?3")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![before_occurred_at, before_event_id, limit], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&payload).map_err(|error| error.to_string())
    })
    .collect()
}

#[tauri::command]
fn export_session_history(
    state: tauri::State<'_, CollectorState>,
    path: String,
) -> Result<usize, String> {
    let output_path = PathBuf::from(path);
    if !output_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("Choisis un fichier avec l’extension .json.".into());
    }
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT payload FROM session_events ORDER BY occurred_at ASC, event_id ASC")
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    let file = fs::File::create(&output_path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    writer.write_all(b"[").map_err(|error| error.to_string())?;
    let mut count = 0usize;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let payload: String = row.get(0).map_err(|error| error.to_string())?;
        if count > 0 {
            writer.write_all(b",").map_err(|error| error.to_string())?;
        }
        writer
            .write_all(payload.as_bytes())
            .map_err(|error| error.to_string())?;
        count += 1;
    }
    writer.write_all(b"]").map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())?;
    Ok(count)
}

#[tauri::command]
fn collector_status(state: tauri::State<'_, CollectorState>) -> String {
    state
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| "error: état indisponible".into())
}

fn persist_event(state: &CollectorState, event: SessionEvent) -> bool {
    let Ok(payload) = serde_json::to_string(&event) else {
        return false;
    };
    let Ok(database) = state.database.lock() else {
        return false;
    };
    if database.execute("INSERT INTO session_events(event_id, session_id, occurred_at, provider, kind, project_path, payload) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(event_id) DO UPDATE SET occurred_at=excluded.occurred_at, provider=excluded.provider, kind=excluded.kind, project_path=excluded.project_path, payload=excluded.payload", params![event.event_id.to_string(), event.session_id, event.occurred_at.to_rfc3339(), event.provider.key(), format!("{:?}", event.kind), event.project_path, payload]).unwrap_or(0) == 0 {
        return false;
    }
    drop(database);
    let _ = state.app.emit("session-event", event);
    true
}

#[tauri::command]
fn repository_snapshot(path: String) -> Result<RepositorySnapshot, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("Le chemin sélectionné n’est pas un dossier.".into());
    }
    let git = |args: &[&str]| -> Result<String, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .map_err(|error| format!("Git n’est pas disponible : {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    };
    let branch = git(&["branch", "--show-current"])
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let status = git(&["status", "--porcelain=v1", "--untracked-files=all"])?;
    let changed_files = status
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let state = line.get(..2)?.trim().to_owned();
            let file = line.get(3..)?.rsplit(" -> ").next()?.to_owned();
            Some(RepositoryFile {
                path: file,
                status: state,
            })
        })
        .collect();
    let commits = git(&[
        "log",
        "-8",
        "--date=relative",
        "--pretty=format:%h%x1f%s%x1f%ar",
    ])?;
    let recent_commits = commits
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{1f}');
            Some(RepositoryCommit {
                short_id: parts.next()?.to_owned(),
                subject: parts.next()?.to_owned(),
                relative_time: parts.next()?.to_owned(),
            })
        })
        .collect();
    Ok(RepositorySnapshot {
        root: root.display().to_string(),
        project_hash: format!("{:x}", Sha256::digest(path.as_bytes())),
        branch,
        changed_files,
        recent_commits,
    })
}

/// Commits whose committer date falls inside `[since, until]`. Git's
/// `--since/--until` prune the walk; the exact bound is re-checked here on the
/// committer timestamp. Being in the window does not attribute a commit to an
/// agent.
#[tauri::command]
fn commits_in_window(path: String, since: String, until: String) -> Result<WindowCommits, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("Le chemin sélectionné n’est pas un dossier.".into());
    }
    let parse = |value: &str| {
        chrono::DateTime::parse_from_rfc3339(value)
            .map(|date| date.with_timezone(&chrono::Utc))
            .map_err(|_| format!("Date invalide : {value}"))
    };
    let (since, until) = (parse(&since)?, parse(&until)?);
    if since > until {
        return Err("La fenêtre de session est inversée.".into());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(&root)
        .arg("log")
        .arg("--all")
        .arg(format!("--since={}", since.timestamp()))
        .arg(format!("--until={}", until.timestamp() + 1))
        .arg(format!("--max-count={}", WINDOW_COMMIT_LIMIT + 1))
        .arg("--date-order")
        .arg("--pretty=format:%H%x1f%h%x1f%ct%x1f%an%x1f%s")
        .output()
        .map_err(|error| format!("Git n’est pas disponible : {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let mut commits = parse_window_commits(
        &String::from_utf8_lossy(&output.stdout),
        since.timestamp(),
        until.timestamp(),
    );
    let truncated = commits.len() > WINDOW_COMMIT_LIMIT;
    commits.truncate(WINDOW_COMMIT_LIMIT);
    Ok(WindowCommits { commits, truncated })
}

fn parse_window_commits(log: &str, since: i64, until: i64) -> Vec<WindowCommit> {
    log.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(5, '\u{1f}');
            let id = parts.next()?.to_owned();
            let short_id = parts.next()?.to_owned();
            let timestamp = parts.next()?.parse::<i64>().ok()?;
            let author = parts.next()?.to_owned();
            let subject = parts.next()?.to_owned();
            if timestamp < since || timestamp > until {
                return None;
            }
            let committed_at = chrono::DateTime::from_timestamp(timestamp, 0)?.to_rfc3339();
            Some(WindowCommit {
                id,
                short_id,
                subject,
                author,
                committed_at,
            })
        })
        .collect()
}

async fn receive_claude_hook(
    State(state): State<CollectorState>,
    request: Request,
) -> impl IntoResponse {
    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == format!("Bearer {}", state.token));
    if !authorized {
        return StatusCode::UNAUTHORIZED;
    }

    let Ok(body) = axum::body::to_bytes(request.into_body(), 64 * 1024).await else {
        return StatusCode::PAYLOAD_TOO_LARGE;
    };
    let Ok(input) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let Some(event) = normalize_claude_event(
        &input,
        state.capture_prompts.load(Ordering::Relaxed),
        state.capture_commands.load(Ordering::Relaxed),
    ) else {
        return StatusCode::NO_CONTENT;
    };
    if !persist_event(&state, event) {
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    StatusCode::NO_CONTENT
}

async fn receive_cursor_hook(
    State(state): State<CollectorState>,
    request: Request,
) -> impl IntoResponse {
    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == format!("Bearer {}", state.token));
    if !authorized {
        return StatusCode::UNAUTHORIZED;
    }
    let Ok(body) = axum::body::to_bytes(request.into_body(), 64 * 1024).await else {
        return StatusCode::PAYLOAD_TOO_LARGE;
    };
    let Ok(input) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let Some(event) =
        normalize_cursor_event(&input, state.capture_commands.load(Ordering::Relaxed))
    else {
        return StatusCode::NO_CONTENT;
    };
    if !persist_event(&state, event) {
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    StatusCode::NO_CONTENT
}

fn normalize_cursor_event(input: &Value, capture_commands: bool) -> Option<SessionEvent> {
    let event_name = input.get("hook_event_name")?.as_str()?;
    let session_id = input
        .get("conversation_id")
        .or_else(|| input.get("session_id"))?
        .as_str()?
        .to_owned();
    let kind = match event_name {
        "sessionStart" => EventKind::SessionStarted,
        "sessionEnd" => EventKind::SessionEnded,
        "postToolUse" | "afterShellExecution" => EventKind::ToolFinished,
        "postToolUseFailure" => EventKind::ToolFailed,
        "afterFileEdit" => EventKind::FileChanged,
        "stop" => EventKind::Checkpoint,
        _ => return None,
    };
    let mut event = SessionEvent::new(session_id, Provider::Cursor, kind);
    event.project_path = input
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            input
                .get("workspace_roots")
                .and_then(Value::as_array)
                .and_then(|roots| roots.first())
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    event.model = input
        .get("model_id")
        .or_else(|| input.get("model"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|value| Sourced {
            value: value.to_owned(),
            origin: DataOrigin::Provider,
        });
    event.tool_name = input
        .get("tool_name")
        .and_then(Value::as_str)
        .map(str::to_owned);
    event.file_path = input
        .get("file_path")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let tool_input = input.get("tool_input");
    event.file_path = event.file_path.or_else(|| {
        tool_input
            .and_then(|value| value.get("file_path").or_else(|| value.get("path")))
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    if capture_commands
        && matches!(
            event_name,
            "afterShellExecution" | "postToolUse" | "postToolUseFailure"
        )
    {
        event.command = input
            .get("command")
            .or_else(|| tool_input.and_then(|value| value.get("command")))
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    event.duration_ms = input
        .get("duration")
        .or_else(|| input.get("duration_ms"))
        .and_then(Value::as_u64)
        .map(|value| Sourced {
            value,
            origin: DataOrigin::Provider,
        });
    event.outcome = input
        .get("status")
        .or_else(|| input.get("failure_type"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    // Never retain Cursor tool outputs, transcript paths, user identity, or thinking text.
    Some(event)
}

fn normalize_claude_event(
    input: &Value,
    capture_prompts: bool,
    capture_commands: bool,
) -> Option<SessionEvent> {
    let event_name = input.get("hook_event_name")?.as_str()?;
    let session_id = input.get("session_id")?.as_str()?.to_owned();
    let kind = match event_name {
        "UserPromptSubmit" => EventKind::UserMessage,
        "PreToolUse" => EventKind::ToolStarted,
        "PostToolUse" => EventKind::ToolFinished,
        "PostToolUseFailure" => EventKind::ToolFailed,
        "Stop" => EventKind::Checkpoint,
        "SessionEnd" => EventKind::SessionEnded,
        _ => return None,
    };
    let mut event = SessionEvent::new(session_id, Provider::ClaudeCode, kind);
    event.project_path = input.get("cwd").and_then(Value::as_str).map(str::to_owned);
    event.tool_name = input
        .get("tool_name")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let tool_input = input.get("tool_input");
    event.file_path = tool_input
        .and_then(|value| value.get("file_path").or_else(|| value.get("path")))
        .and_then(Value::as_str)
        .map(str::to_owned);
    if capture_prompts && event_name == "UserPromptSubmit" {
        event.content = input
            .get("prompt")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    if capture_commands && matches!(event.tool_name.as_deref(), Some("Bash" | "PowerShell")) {
        event.command = tool_input
            .and_then(|value| value.get("command"))
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    event.outcome = input
        .get("error")
        .and_then(Value::as_str)
        .map(|_| "failed".to_owned());
    if event_name == "PostToolUse" && event.tool_name.as_deref() == Some("Agent") {
        let response = input.get("tool_response");
        if let Some(usage) = response.and_then(|value| value.get("usage")) {
            event.input_tokens = usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .map(|value| Sourced {
                    value,
                    origin: DataOrigin::Provider,
                });
            event.output_tokens = usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .map(|value| Sourced {
                    value,
                    origin: DataOrigin::Provider,
                });
        }
        event.model = response
            .and_then(|value| value.get("resolvedModel"))
            .and_then(Value::as_str)
            .map(|value| Sourced {
                value: value.to_owned(),
                origin: DataOrigin::Provider,
            });
        event.duration_ms = response
            .and_then(|value| value.get("totalDurationMs"))
            .and_then(Value::as_u64)
            .map(|value| Sourced {
                value,
                origin: DataOrigin::Provider,
            });
    }
    // Prompt and shell-command retention is separately opt-in; tool outputs and
    // transcript paths are always excluded.
    Some(event)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            fs::create_dir_all(&config_dir)?;
            let token_path = config_dir.join("collector-token");
            let token = fs::read_to_string(&token_path).unwrap_or_else(|_| {
                let token = Uuid::new_v4().to_string();
                let _ = fs::write(&token_path, &token);
                token
            });
            let data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let connection = Connection::open(data_dir.join("observer.sqlite3"))?;
            connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS session_events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, occurred_at TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL, project_path TEXT, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_session_events_time ON session_events(occurred_at); CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value INTEGER NOT NULL);")?;
            let preference = |key: &str| -> bool {
                connection.query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| row.get::<_, i64>(0)).optional().ok().flatten().unwrap_or(0) != 0
            };
            let capture_prompts = preference("capture_prompts");
            let capture_commands = preference("capture_commands");
            let state = CollectorState {
                app: app.handle().clone(),
                token,
                database: Arc::new(Mutex::new(connection)),
                status: Arc::new(Mutex::new("starting".into())),
                capture_prompts: Arc::new(AtomicBool::new(capture_prompts)),
                capture_commands: Arc::new(AtomicBool::new(capture_commands)),
            };
            let port = 43821;
            let address = SocketAddr::from(([127, 0, 0, 1], port));
            let router = Router::new()
                .route("/claude-hook", post(receive_claude_hook))
                .route("/cursor-hook", post(receive_cursor_hook))
                .with_state(state.clone());
            let handle = app.handle().clone();
            let status = state.status.clone();
            tauri::async_runtime::spawn(async move {
                match tokio::net::TcpListener::bind(address).await {
                    Ok(listener) => {
                        if let Ok(mut value) = status.lock() { *value = "listening".into(); }
                        let _ = axum::serve(listener, router).await;
                    }
                    Err(error) => {
                        if let Ok(mut value) = status.lock() { *value = format!("error: {error}"); }
                        let _ = handle.emit("collector-error", error.to_string());
                    }
                }
            });
            let codex_state = state.clone();
            codex_rollout::spawn(
                codex_rollout::sessions_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&codex_state, event);
                },
            );
            let gemini_state = state.clone();
            gemini_sessions::spawn(
                gemini_sessions::sessions_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&gemini_state, event);
                },
            );
            let qwen_state = state.clone();
            qwen_sessions::spawn(
                qwen_sessions::projects_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&qwen_state, event);
                },
            );
            let opencode_state = state.clone();
            opencode_sessions::spawn(
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&opencode_state, event);
                },
            );
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![claude_setup, codex_setup, gemini_setup, opencode_setup, qwen_setup, cursor_setup, load_session_events, export_session_history, repository_snapshot, commits_in_window, collector_status, update_capture_policy, clear_session_history])
        .run(tauri::generate_context!())
        .expect("failed to run Agent Observer");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_tool_and_file_events_exclude_outputs_and_gate_commands() {
        let input = json!({
            "hook_event_name": "postToolUse",
            "conversation_id": "cursor-conversation",
            "generation_id": "generation-2",
            "model_id": "cursor-model",
            "cwd": "C:/work/repo",
            "tool_name": "Shell",
            "tool_input": { "command": "Get-ChildItem" },
            "tool_output": "must not be retained",
            "duration": 1250
        });
        let omitted = normalize_cursor_event(&input, false).unwrap();
        assert_eq!(omitted.provider, Provider::Cursor);
        assert_eq!(omitted.kind, EventKind::ToolFinished);
        assert_eq!(omitted.command, None);
        assert_eq!(
            omitted.model.as_ref().map(|value| value.value.as_str()),
            Some("cursor-model")
        );
        assert_eq!(
            omitted.duration_ms.as_ref().map(|value| value.value),
            Some(1250)
        );
        let captured = normalize_cursor_event(&input, true).unwrap();
        assert_eq!(captured.command.as_deref(), Some("Get-ChildItem"));
        assert_eq!(captured.content, None);

        let edit = json!({
            "hook_event_name": "afterFileEdit",
            "conversation_id": "cursor-conversation",
            "file_path": "C:/work/repo/src/main.rs",
            "edits": [{"old_string": "secret", "new_string": "replacement"}]
        });
        let event = normalize_cursor_event(&edit, false).unwrap();
        assert_eq!(event.kind, EventKind::FileChanged);
        assert_eq!(event.file_path.as_deref(), Some("C:/work/repo/src/main.rs"));
        assert_eq!(event.content, None);
    }

    #[test]
    fn cursor_session_events_require_session_identity_and_drop_unrecognized_hooks() {
        assert!(
            normalize_cursor_event(&json!({"hook_event_name":"sessionStart"}), false).is_none()
        );
        assert!(
            normalize_cursor_event(
                &json!({"hook_event_name":"workspaceOpen","workspace_roots":[]}),
                false
            )
            .is_none()
        );
        let ended = normalize_cursor_event(&json!({"hook_event_name":"sessionEnd","session_id":"s-1","duration_ms":2000,"reason":"completed"}), false).unwrap();
        assert_eq!(ended.kind, EventKind::SessionEnded);
        assert_eq!(
            ended.duration_ms.as_ref().map(|value| value.value),
            Some(2000)
        );
    }

    #[test]
    fn window_commits_keep_only_commits_inside_the_bounds() {
        let log = "aaa\u{1f}a1\u{1f}100\u{1f}Ada\u{1f}before\n\
                   bbb\u{1f}b2\u{1f}150\u{1f}Bob\u{1f}inside: a\u{1f}b\n\
                   ccc\u{1f}c3\u{1f}200\u{1f}Cy\u{1f}on the edge\n\
                   ddd\u{1f}d4\u{1f}201\u{1f}Di\u{1f}after\n\
                   malformed line";
        let commits = parse_window_commits(log, 150, 200);
        assert_eq!(
            commits
                .iter()
                .map(|commit| commit.short_id.as_str())
                .collect::<Vec<_>>(),
            ["b2", "c3"]
        );
        assert_eq!(commits[0].subject, "inside: a\u{1f}b");
        assert_eq!(commits[0].author, "Bob");
        assert_eq!(commits[0].committed_at, "1970-01-01T00:02:30+00:00");
    }

    #[test]
    fn claude_prompt_and_shell_command_capture_are_opt_in() {
        let prompt = json!({
            "hook_event_name": "UserPromptSubmit",
            "session_id": "claude-session",
            "cwd": "C:/work/demo",
            "prompt": "private prompt"
        });
        let omitted = normalize_claude_event(&prompt, false, false).unwrap();
        let captured = normalize_claude_event(&prompt, true, false).unwrap();
        assert_eq!(omitted.kind, EventKind::UserMessage);
        assert_eq!(omitted.content, None);
        assert_eq!(captured.content.as_deref(), Some("private prompt"));

        let command = json!({
            "hook_event_name": "PreToolUse",
            "session_id": "claude-session",
            "tool_name": "PowerShell",
            "tool_input": { "command": "Get-ChildItem" }
        });
        let omitted = normalize_claude_event(&command, false, false).unwrap();
        let captured = normalize_claude_event(&command, false, true).unwrap();
        assert_eq!(omitted.kind, EventKind::ToolStarted);
        assert_eq!(omitted.command, None);
        assert_eq!(captured.command.as_deref(), Some("Get-ChildItem"));
    }
}
