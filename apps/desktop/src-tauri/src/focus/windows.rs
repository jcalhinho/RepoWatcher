//! Windows: bring forward the top-level window of the application hosting the agent — Windows
//! Terminal, a classic console (owned by a `conhost.exe` child of the shell) or an editor window
//! whose title names the project.

use super::launch::Host;
use super::{ProcInfo, tr};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SW_RESTORE,
    SetForegroundWindow, ShowWindow,
};
use windows::core::BOOL;

struct Search {
    pids: Vec<u32>,
    title_hint: Option<String>,
    found: Vec<(usize, HWND, String)>,
}

unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = unsafe { &mut *(lparam.0 as *mut Search) };
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return BOOL(1);
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32)) };
    if let Some(rank) = search.pids.iter().position(|candidate| *candidate == pid) {
        let mut buffer = [0u16; 512];
        let length = unsafe { GetWindowTextW(hwnd, &mut buffer) } as usize;
        let title = String::from_utf16_lossy(&buffer[..length]);
        if !title.is_empty() {
            search.found.push((rank, hwnd, title));
        }
    }
    BOOL(1)
}

pub fn bring_forward(
    chain: &[ProcInfo],
    processes: &[ProcInfo],
    project: Option<&str>,
) -> Result<String, String> {
    // Candidates closest to the agent first: its ancestors, then console hosts started by them.
    let mut pids: Vec<u32> = chain.iter().map(|process| process.pid).collect();
    for process in chain {
        for child in processes
            .iter()
            .filter(|candidate| candidate.parent == Some(process.pid))
        {
            let name = child.name.to_lowercase();
            if (name == "conhost.exe" || name == "openconsole.exe") && !pids.contains(&child.pid) {
                pids.push(child.pid);
            }
        }
    }
    let title_hint = project.and_then(|path| {
        path.replace('\\', "/")
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .map(str::to_lowercase)
    });
    let mut search = Search {
        pids,
        title_hint,
        found: Vec::new(),
    };
    unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) }
        .map_err(|error| error.to_string())?;
    // Prefer the closest host; among its windows, the one whose title names the project.
    search.found.sort_by_key(|(rank, _, title)| {
        (
            *rank,
            !search
                .title_hint
                .as_ref()
                .is_some_and(|hint| title.to_lowercase().contains(hint)),
        )
    });
    let Some((_, hwnd, title)) = search.found.first().cloned() else {
        return Err(tr(
            "Fenêtre de l’agent introuvable.",
            "Agent window not found.",
        ));
    };
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if !SetForegroundWindow(hwnd).as_bool() {
            return Err(tr(
                "Windows a refusé de mettre la fenêtre au premier plan.",
                "Windows refused to bring the window to the front.",
            ));
        }
    }
    Ok(tr(
        &format!("Fenêtre « {title} » mise au premier plan."),
        &format!("Window “{title}” brought to the front."),
    ))
}

/// Starts `command` in `folder`: in a new Windows Terminal (or console) window, or, for an
/// editor, the folder is opened and the command copied for its integrated terminal.
pub fn open_in_host(host: Host, folder: &str, command: &str) -> Result<String, String> {
    use std::process::Command;
    if host.is_editor() {
        let program = match host {
            Host::Cursor => "cursor",
            Host::Windsurf => "windsurf",
            _ => "code",
        };
        Command::new("cmd")
            .args(["/C", program, folder])
            .spawn()
            .map_err(|error| error.to_string())?;
        // `clip` reads the command from its standard input.
        let mut clip = Command::new("clip")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;
        std::io::Write::write_all(&mut clip.stdin.take().ok_or("clip")?, command.as_bytes())
            .map_err(|error| error.to_string())?;
        let _ = clip.wait();
        return Ok(tr(
            &format!(
                "Éditeur ouvert sur le projet. Commande copiée : colle-la dans son terminal ({command})."
            ),
            &format!(
                "Editor opened on the project. Command copied: paste it in its terminal ({command})."
            ),
        ));
    }
    // Windows Terminal when installed, a classic console otherwise.
    let with_wt = Command::new("wt.exe")
        .args(["-d", folder, "cmd", "/k", command])
        .spawn();
    if with_wt.is_err() {
        Command::new("cmd")
            .args([
                "/C",
                "start",
                "Agent Observer",
                "/D",
                folder,
                "cmd",
                "/k",
                command,
            ])
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(tr(
        &format!("Agent relancé dans un nouveau terminal : {command}"),
        &format!("Agent started again in a new terminal: {command}"),
    ))
}
