//! "Go to the agent": find the process of an agent session and bring the terminal or editor that
//! hosts it to the front. Finding the process is pure logic over a process snapshot (tested);
//! bringing a window forward is platform code (`macos.rs`, `windows.rs`).

use crate::no_window::Quiet;
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

/// Records where the agent process `pid` runs, for a session.
pub fn note_host(session_id: &str, pid: u32) {
    let processes = snapshot();
    if let Some(host) = launch::host_of(&ancestors(&processes, pid)) {
        remember_host(session_id, host);
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

/// Programs that run an agent written for them: the script they are given names the agent.
const INTERPRETERS: &[&str] = &[
    "node", "nodejs", "bun", "deno", "python", "python3", "npx", "tsx",
];

/// Path of the program a process runs: its executable, or the first word of its command line.
fn program_path(process: &ProcInfo) -> String {
    let path = process
        .exe
        .as_deref()
        .unwrap_or_else(|| process.cmd.split_whitespace().next().unwrap_or_default());
    path.replace('\\', "/")
}

fn file_stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_owned()
}

/// A part of a path or a program name that names the agent: `codex`, `codex-aarch64`, `qwen-code`,
/// `gemini-cli`, `@openai/codex`, `codex.js`.
fn names_agent(part: &str, marker: &str) -> bool {
    let part = part.trim_start_matches('@');
    part == marker
        || part.starts_with(&format!("{marker}-"))
        || part.starts_with(&format!("{marker}."))
}

/// The application shell of a desktop app (Claude, Codex…) or this observer: a host, not a session.
fn is_host_or_self(process: &ProcInfo) -> bool {
    let program = program_path(process).to_lowercase();
    let name = process.name.to_lowercase();
    // `X.app/Contents/MacOS/X` is the window process of a macOS app. The engine that Claude
    // Desktop starts for each session also lives in an `.app`, in its own data folder.
    let app_shell =
        program.contains(".app/contents/macos/") && !program.contains("/application support/");
    app_shell
        || program.contains("repowatcher")
        || program.contains("agent observer")
        || name.contains("agent observer")
        || program.contains("crashpad")
        // Windows: the Claude desktop app is installed under AnthropicClaude.
        || program.contains("anthropicclaude")
}

fn is_agent_process(process: &ProcInfo, provider: &str) -> bool {
    if is_host_or_self(process) {
        return false;
    }
    let program = program_path(process);
    let stem = file_stem(&program);
    agent_markers(provider).iter().any(|marker| {
        if names_agent(&stem, marker) {
            return true;
        }
        // `node /usr/local/bin/qwen`, `node …/@google/gemini-cli/dist/index.js`
        INTERPRETERS.contains(&stem.as_str())
            && process
                .cmd
                .split_whitespace()
                .skip(1)
                .find(|word| !word.starts_with('-'))
                .is_some_and(|script| {
                    script
                        .replace('\\', "/")
                        .to_lowercase()
                        .split('/')
                        .any(|part| names_agent(part, marker))
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

/// The command line program of each agent.
fn binary_name(provider: &str) -> Option<&'static str> {
    Some(match provider {
        "claude_code" => "claude",
        "codex" => "codex",
        "gemini_cli" => "gemini",
        "qwen_code" => "qwen",
        "opencode" => "opencode",
        _ => return None,
    })
}

/// Whether the agent's program is installed, as a terminal would find it (a desktop app has a
/// shorter PATH than the user's shell, so the shell is asked).
fn cli_installed(provider: &str) -> bool {
    let Some(binary) = binary_name(provider) else {
        return false;
    };
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("where")
            .arg(binary)
            .quiet()
            .output()
            .is_ok_and(|output| output.status.success())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        std::process::Command::new(shell)
            .args(["-ilc", &format!("command -v {binary}")])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .is_ok_and(|output| output.status.success())
    }
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(Into::into)
}

/// Path of the agent's own desktop application, when installed.
fn desktop_app(provider: &str) -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let name = match provider {
            "claude_code" => "Claude",
            "codex" => "Codex",
            "opencode" => "OpenCode",
            _ => return None,
        };
        let mut folders = vec![std::path::PathBuf::from("/Applications")];
        folders.extend(home_dir().map(|home| home.join("Applications")));
        folders
            .into_iter()
            .map(|folder| folder.join(format!("{name}.app")))
            .find(|path| path.is_dir())
    }
    #[cfg(target_os = "windows")]
    {
        let local = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA")?);
        let candidates: &[&str] = match provider {
            "claude_code" => &[
                "AnthropicClaude\\claude.exe",
                "Programs\\Claude\\Claude.exe",
            ],
            "codex" => &["Programs\\Codex\\Codex.exe"],
            _ => &[],
        };
        candidates
            .iter()
            .map(|path| local.join(path))
            .find(|path| path.is_file())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = provider;
        None
    }
}

/// An editor that has the agent's extension installed.
fn editor_with_extension(provider: &str) -> Option<launch::Host> {
    let prefixes: &[&str] = match provider {
        "claude_code" => &["anthropic.claude-code-"],
        "codex" => &["openai.chatgpt-", "openai.codex-"],
        "opencode" => &["sst-dev.opencode-"],
        "qwen_code" => &["qwenlm.qwen-code"],
        "gemini_cli" => &["google.gemini-cli"],
        _ => return None,
    };
    let home = home_dir()?;
    [
        (".vscode", launch::Host::Code),
        (".cursor", launch::Host::Cursor),
        (".windsurf", launch::Host::Windsurf),
    ]
    .into_iter()
    .find(|(folder, _)| {
        std::fs::read_dir(home.join(folder).join("extensions")).is_ok_and(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                prefixes.iter().any(|prefix| name.starts_with(prefix))
            })
        })
    })
    .map(|(_, host)| host)
}

/// The agent is not running: bring its session back where it was (its desktop app, a terminal or
/// an editor), or where the user prefers, using only what is installed.
fn relaunch(
    provider: &str,
    session_id: Option<&str>,
    preferred_host: Option<&str>,
    fallback_folder: Option<String>,
) -> FocusOutcome {
    let failure = |message: String, fallback_folder| FocusOutcome {
        ok: false,
        message,
        fallback_folder,
    };
    let Some(folder) = fallback_folder.clone() else {
        return failure(
            tr(
                "Agent introuvable et son dossier est inconnu ou n’existe plus.",
                "Agent not found, and its folder is unknown or no longer exists.",
            ),
            None,
        );
    };
    let available = launch::Availability {
        cli: cli_installed(provider),
        desktop: desktop_app(provider).is_some(),
        editor: editor_with_extension(provider),
    };
    let plan = launch::plan(
        session_id.and_then(remembered_host),
        preferred_host.and_then(launch::Host::parse),
        &available,
    );
    let result = match plan {
        launch::Plan::Run(host) => match launch::resume_command(provider, session_id) {
            Some(command) => open_in_host(host, &folder, Some(&command)),
            None => Err(tr(
                "Cet agent ne peut pas être relancé depuis ici.",
                "This agent can't be started again from here.",
            )),
        },
        launch::Plan::Editor(host) => open_in_host(host, &folder, None),
        launch::Plan::Desktop => desktop_app(provider)
            .ok_or_else(|| String::from("desktop app"))
            .and_then(|path| open_app(&path)),
        launch::Plan::Nothing => Err(tr(
            "Agent arrêté, et rien pour le relancer : ni commande en ligne, ni application, ni extension d’éditeur. Ouvre le dossier et relance-le toi-même.",
            "Agent stopped, and nothing to start it with: no command line, desktop app or editor extension. Open the folder and start it yourself.",
        )),
    };
    match result {
        Ok(message) => FocusOutcome {
            ok: true,
            message,
            fallback_folder: None,
        },
        Err(message) => failure(message, fallback_folder),
    }
}

#[cfg(target_os = "macos")]
fn open_in_host(host: launch::Host, folder: &str, command: Option<&str>) -> Result<String, String> {
    macos::open_in_host(host, folder, command)
}

#[cfg(target_os = "windows")]
fn open_in_host(host: launch::Host, folder: &str, command: Option<&str>) -> Result<String, String> {
    windows::open_in_host(host, folder, command)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_in_host(
    _host: launch::Host,
    _folder: &str,
    _command: Option<&str>,
) -> Result<String, String> {
    Err(tr(
        "Relancer un agent n’est pas pris en charge sur ce système.",
        "Starting an agent again is not supported on this system.",
    ))
}

#[cfg(target_os = "macos")]
fn open_app(path: &Path) -> Result<String, String> {
    macos::open_app(path)
}

#[cfg(target_os = "windows")]
fn open_app(path: &Path) -> Result<String, String> {
    windows::open_app(path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_app(_path: &Path) -> Result<String, String> {
    Err(tr(
        "Ouvrir une application n’est pas pris en charge sur ce système.",
        "Opening an application is not supported on this system.",
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
            .quiet()
            .args(["-ano", "-p", "TCP"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        text.lines().find_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            (parts.len() >= 5 && parts[1].ends_with(&format!(":{port}")))
                .then(|| parts[4].parse::<u32>().ok())
                .flatten()
                .filter(|pid| *pid != own)
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("lsof")
            .quiet()
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

    fn exe_process(pid: u32, parent: Option<u32>, exe: &str, cmd: &str, cwd: &str) -> ProcInfo {
        ProcInfo {
            pid,
            parent,
            name: exe.rsplit('/').next().unwrap().to_owned(),
            cmd: cmd.into(),
            exe: Some(exe.into()),
            cwd: Some(cwd.into()),
            start_time: pid as u64,
        }
    }

    #[test]
    fn finds_claude_in_the_desktop_app_and_in_vs_code() {
        let engine = "/Users/me/Library/Application Support/Claude/claude-code/2.1.308/abc/claude.app/Contents/MacOS/claude";
        let extension = "/Users/me/.vscode/extensions/anthropic.claude-code-2.1.306-darwin-arm64/resources/native-binary/claude";
        let processes = vec![
            exe_process(1, None, "/sbin/launchd", "/sbin/launchd", "/"),
            exe_process(
                2,
                Some(1),
                "/Applications/Claude.app/Contents/MacOS/Claude",
                "/Applications/Claude.app/Contents/MacOS/Claude",
                "/",
            ),
            exe_process(
                3,
                Some(2),
                "/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper",
                "Claude Helper --user-data-dir=/Users/me/Library/Application Support/Claude",
                "/",
            ),
            exe_process(
                4,
                Some(2),
                "/Applications/Claude.app/Contents/Helpers/disclaimer",
                &format!("disclaimer --pgroup -- {engine} --output-format stream-json"),
                "/Users/me/app",
            ),
            exe_process(
                5,
                Some(4),
                engine,
                &format!("{engine} --output-format stream-json"),
                "/Users/me/app",
            ),
            exe_process(
                6,
                Some(1),
                "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)",
                "Code Helper (Plugin)",
                "/",
            ),
            exe_process(7, Some(6), extension, extension, "/Users/me/web"),
        ];
        // Desktop engine: neither the app window, its helpers nor the wrapper count as sessions.
        assert_eq!(
            find_agent_process(&processes, "claude_code", Some("/Users/me/app")),
            Some(5)
        );
        assert_eq!(
            find_agent_process(&processes, "claude_code", Some("/Users/me/web")),
            Some(7)
        );
        let chain: Vec<u32> = ancestors(&processes, 5).iter().map(|p| p.pid).collect();
        assert_eq!(chain, vec![5, 4, 2, 1]);
        assert_eq!(
            launch::host_of(&ancestors(&processes, 5)),
            Some(launch::Host::Desktop)
        );
        assert_eq!(
            launch::host_of(&ancestors(&processes, 7)),
            Some(launch::Host::Code)
        );
    }

    /// Reads this computer's real processes: `cargo test -- --ignored --nocapture real_processes`.
    #[test]
    #[ignore]
    fn real_processes() {
        let processes = snapshot();
        for provider in [
            "claude_code",
            "codex",
            "gemini_cli",
            "qwen_code",
            "opencode",
        ] {
            let found: Vec<_> = processes
                .iter()
                .filter(|process| is_agent_process(process, provider))
                .map(|process| {
                    (
                        process.pid,
                        process.cwd.clone().unwrap_or_default(),
                        launch::host_of(&ancestors(&processes, process.pid)),
                    )
                })
                .collect();
            println!("{provider}: {found:#?}");
            println!(
                "  cli={} desktop={:?} editor={:?}",
                cli_installed(provider),
                desktop_app(provider),
                editor_with_extension(provider)
            );
        }
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
