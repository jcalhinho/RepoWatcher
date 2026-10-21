//! "Go to the agent": find the process of an agent session and bring the terminal or editor that
//! hosts it to the front. Finding the process is pure logic over a process snapshot (tested);
//! bringing a window forward is platform code (`macos.rs`, `windows.rs`).

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

pub mod launch;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Language of the messages shown to the user, set by the UI with each request.
static FRENCH: AtomicBool = AtomicBool::new(false);

pub fn set_language(lang: Option<&str>) {
    FRENCH.store(lang == Some("fr"), Ordering::Relaxed);
}

pub(crate) fn tr(fr: &str, en: &str) -> String {
    if FRENCH.load(Ordering::Relaxed) {
        fr
    } else {
        en
    }
    .to_owned()
}

/// The terminal or editor each session was last seen in, so a session that ended is started
/// again where it was.
static LAST_HOST: Mutex<Option<HashMap<String, launch::Host>>> = Mutex::new(None);

fn remember_host(session_id: &str, host: launch::Host) {
    if let Ok(mut map) = LAST_HOST.lock() {
        map.get_or_insert_with(HashMap::new)
            .insert(session_id.to_owned(), host);
    }
}

fn remembered_host(session_id: &str) -> Option<launch::Host> {
    LAST_HOST.lock().ok()?.as_ref()?.get(session_id).copied()
}

/// What happened, in words the UI can show as is.
#[derive(Debug, Serialize, PartialEq)]
pub struct FocusOutcome {
    pub ok: bool,
    pub message: String,
    /// Folder the UI can offer to open when the agent could not be reached.
    pub fallback_folder: Option<String>,
}

/// The part of a process the search needs, so it can be tested without a real system.
#[derive(Debug, Clone, PartialEq)]
pub struct ProcInfo {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub cmd: String,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    pub start_time: u64,
}

/// Command-line markers of each agent's process.
fn agent_markers(provider: &str) -> &'static [&'static str] {
    match provider {
        "claude_code" => &["claude"],
        "codex" => &["codex"],
        "gemini_cli" => &["gemini"],
        "qwen_code" => &["qwen"],
        "opencode" => &["opencode"],
        _ => &[],
    }
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn is_agent_process(process: &ProcInfo, provider: &str) -> bool {
    let haystack = format!("{} {}", process.name, process.cmd).to_lowercase();
    // The observer itself, editors and helper processes mention agent names in their paths too.
    // GUI applications (macOS bundles, the Claude desktop app) are hosts, not agent sessions.
    if haystack.contains("agent observer")
        || haystack.contains("repowatcher")
        || haystack.contains("crashpad")
        || haystack.contains(".app/contents/")
        || haystack.contains("anthropicclaude")
    {
        return false;
    }
    agent_markers(provider).iter().any(|marker| {
        process.name.to_lowercase().starts_with(marker)
            || haystack.split([' ', '/', '\\']).any(|part| {
                part == *marker
                    || part.starts_with(&format!("{marker}."))
                    || part == format!("@{marker}")
                    || part.ends_with(&format!("{marker}-cli"))
            })
    })
}

/// The agent process running in `project` (or one of its subfolders); the most recent if several.
pub fn find_agent_process(
    processes: &[ProcInfo],
    provider: &str,
    project: Option<&str>,
) -> Option<u32> {
    let project = project.map(normalize);
    processes
        .iter()
        .filter(|process| is_agent_process(process, provider))
        .filter(|process| match (&project, &process.cwd) {
            (Some(project), Some(cwd)) => {
                let cwd = normalize(cwd);
                cwd == *project
                    || cwd.starts_with(&format!("{project}/"))
                    || project.starts_with(&format!("{cwd}/"))
            }
            (Some(_), None) => false,
            (None, _) => true,
        })
        // Child processes of the agent (shells it spawned) share its markers: keep the top-most.
        .filter(|process| {
            !process
                .parent
                .and_then(|parent| processes.iter().find(|candidate| candidate.pid == parent))
                .is_some_and(|parent| is_agent_process(parent, provider))
        })
        .max_by_key(|process| process.start_time)
        .map(|process| process.pid)
}

/// The process and its ancestors, closest first (cycles and missing parents end the chain).
pub fn ancestors(processes: &[ProcInfo], pid: u32) -> Vec<ProcInfo> {
    let mut chain = Vec::new();
    let mut current = processes.iter().find(|process| process.pid == pid);
    while let Some(process) = current {
        if chain.iter().any(|seen: &ProcInfo| seen.pid == process.pid) || chain.len() > 64 {
            break;
        }
        chain.push(process.clone());
        current = process
            .parent
            .and_then(|parent| processes.iter().find(|candidate| candidate.pid == parent));
    }
    chain
}

/// A snapshot of every process with what the search needs.
pub fn snapshot() -> Vec<ProcInfo> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );
    system
        .processes()
        .values()
        .map(|process| ProcInfo {
            pid: process.pid().as_u32(),
            parent: process.parent().map(Pid::as_u32),
            name: process.name().to_string_lossy().into_owned(),
            cmd: process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" "),
            exe: process.exe().map(|path| path.display().to_string()),
            cwd: process.cwd().map(|path| path.display().to_string()),
            start_time: process.start_time(),
        })
        .collect()
}

/// Brings the agent's terminal or editor to the front. `known_pid` comes from the collector
/// (Claude Code hooks); other agents are searched by name and folder.
pub fn focus_agent(
    provider: &str,
    known_pid: Option<u32>,
    project: Option<&str>,
    session_id: Option<&str>,
    preferred_host: Option<&str>,
) -> FocusOutcome {
    let processes = snapshot();
    let pid = known_pid
        .filter(|pid| processes.iter().any(|process| process.pid == *pid))
        .or_else(|| find_agent_process(&processes, provider, project));
    let fallback_folder = project
        .filter(|path| Path::new(path).is_dir())
        .map(str::to_owned);
    let Some(pid) = pid else {
        return relaunch(provider, session_id, preferred_host, fallback_folder);
    };
    let chain = ancestors(&processes, pid);
    if let (Some(id), Some(host)) = (session_id, launch::host_of(&chain)) {
        remember_host(id, host);
    }
    match bring_forward(&chain, &processes, project) {
        Ok(message) => FocusOutcome {
            ok: true,
            message,
            fallback_folder: None,
        },
        Err(message) => FocusOutcome {
            ok: false,
            message,
            fallback_folder,
        },
    }
}

#[cfg(target_os = "macos")]
fn bring_forward(
    chain: &[ProcInfo],
    _processes: &[ProcInfo],
    project: Option<&str>,
) -> Result<String, String> {
    macos::bring_forward(chain, project)
}

#[cfg(target_os = "windows")]
fn bring_forward(
    chain: &[ProcInfo],
    processes: &[ProcInfo],
    project: Option<&str>,
) -> Result<String, String> {
    windows::bring_forward(chain, processes, project)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn bring_forward(
    _chain: &[ProcInfo],
    _processes: &[ProcInfo],
    _project: Option<&str>,
) -> Result<String, String> {
    Err(tr(
        "Mise au premier plan non prise en charge sur ce système.",
        "Bringing windows forward is not supported on this system.",
    ))
}

/// The agent is not running: start its session again in the terminal or editor it was in, or in
/// the one the user prefers.
fn relaunch(
    provider: &str,
    session_id: Option<&str>,
    preferred_host: Option<&str>,
    fallback_folder: Option<String>,
) -> FocusOutcome {
    let not_found = |fallback_folder| FocusOutcome {
        ok: false,
        message: tr(
            "Agent introuvable et impossible de le relancer (dossier ou commande inconnus).",
            "Agent not found and it can't be started again (unknown folder or command).",
        ),
        fallback_folder,
    };
    let (Some(folder), Some(command)) = (
        fallback_folder.as_deref(),
        launch::resume_command(provider, session_id),
    ) else {
        return not_found(fallback_folder);
    };
    let host = session_id
        .and_then(remembered_host)
        .or_else(|| preferred_host.and_then(launch::Host::parse))
        .unwrap_or(launch::Host::Terminal);
    match open_in_host(host, folder, &command) {
        Ok(message) => FocusOutcome {
            ok: true,
            message,
            fallback_folder: None,
        },
        Err(message) => FocusOutcome {
            ok: false,
            message,
            fallback_folder,
        },
    }
}

#[cfg(target_os = "macos")]
fn open_in_host(host: launch::Host, folder: &str, command: &str) -> Result<String, String> {
    macos::open_in_host(host, folder, command)
}

#[cfg(target_os = "windows")]
fn open_in_host(host: launch::Host, folder: &str, command: &str) -> Result<String, String> {
    windows::open_in_host(host, folder, command)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_in_host(_host: launch::Host, _folder: &str, _command: &str) -> Result<String, String> {
    Err(tr(
        "Relancer un agent n’est pas pris en charge sur ce système.",
        "Starting an agent again is not supported on this system.",
    ))
}

/// Opens a folder in Finder / Explorer / the file manager.
pub fn reveal_folder(path: &str) -> Result<(), String> {
    if !Path::new(path).is_dir() {
        return Err(tr(
            "Ce dossier n’existe plus.",
            "This folder no longer exists.",
        ));
    }
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// PID of the local process whose TCP connection uses `port` (the client side of a hook request).
pub fn pid_for_local_port(port: u16) -> Option<u32> {
    let own = std::process::id();
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        return text.lines().find_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            (parts.len() >= 5 && parts[1].ends_with(&format!(":{port}")))
                .then(|| parts[4].parse::<u32>().ok())
                .flatten()
                .filter(|pid| *pid != own)
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:ESTABLISHED", "-Fp"])
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.strip_prefix('p')?.parse::<u32>().ok())
            .find(|pid| *pid != own)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(
        pid: u32,
        parent: Option<u32>,
        name: &str,
        cmd: &str,
        cwd: Option<&str>,
        start_time: u64,
    ) -> ProcInfo {
        ProcInfo {
            pid,
            parent,
            name: name.into(),
            cmd: cmd.into(),
            exe: None,
            cwd: cwd.map(str::to_owned),
            start_time,
        }
    }

    fn tree() -> Vec<ProcInfo> {
        vec![
            process(1, None, "launchd", "/sbin/launchd", None, 0),
            process(
                10,
                Some(1),
                "Terminal",
                "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
                None,
                10,
            ),
            process(11, Some(10), "zsh", "-zsh", Some("/Users/me/api"), 11),
            process(
                12,
                Some(11),
                "node",
                "node /opt/homebrew/bin/codex",
                Some("/Users/me/api"),
                12,
            ),
            process(
                13,
                Some(12),
                "codex",
                "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex-aarch64",
                Some("/Users/me/api"),
                13,
            ),
            process(
                14,
                Some(13),
                "bash",
                "bash -c cargo test",
                Some("/Users/me/api"),
                14,
            ),
            process(20, Some(10), "zsh", "-zsh", Some("/Users/me/web"), 20),
            process(
                21,
                Some(20),
                "node",
                "node /usr/local/bin/qwen",
                Some("/Users/me/web/packages/ui"),
                21,
            ),
            process(
                30,
                Some(1),
                "Agent Observer",
                "/Applications/RepoWatcher Agent Observer.app/Contents/MacOS/repowatcher-agent-observer codex",
                Some("/"),
                30,
            ),
            process(
                31,
                Some(1),
                "Claude",
                "/Applications/Claude.app/Contents/MacOS/Claude",
                Some("/Users/me/api"),
                31,
            ),
        ]
    }

    #[test]
    fn finds_the_top_agent_process_in_the_project_folder() {
        let processes = tree();
        assert_eq!(
            find_agent_process(&processes, "codex", Some("/Users/me/api")),
            Some(12)
        );
        assert_eq!(
            find_agent_process(&processes, "qwen_code", Some("/Users/me/web")),
            Some(21)
        );
        assert_eq!(
            find_agent_process(&processes, "codex", Some("/Users/me/web")),
            None
        );
        assert_eq!(
            find_agent_process(&processes, "gemini_cli", Some("/Users/me/api")),
            None
        );
        // The Claude desktop app is not a Claude Code session.
        assert_eq!(
            find_agent_process(&processes, "claude_code", Some("/Users/me/api")),
            None
        );
    }

    #[test]
    fn walks_up_to_the_hosting_application() {
        let names: Vec<String> = ancestors(&tree(), 13)
            .into_iter()
            .map(|process| process.name)
            .collect();
        assert_eq!(names, vec!["codex", "node", "zsh", "Terminal", "launchd"]);
    }

    #[test]
    fn matches_windows_paths_case_insensitively() {
        let processes = vec![process(
            5,
            None,
            "node.exe",
            "node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js",
            Some("C:\\Work\\Api"),
            5,
        )];
        assert_eq!(
            find_agent_process(&processes, "gemini_cli", Some("c:/work/api")),
            Some(5)
        );
    }
}
