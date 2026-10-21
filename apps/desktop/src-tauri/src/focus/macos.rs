//! macOS: select the Terminal / iTerm2 tab running the agent, open the project window of an
//! editor, or activate whichever application hosts the agent.

use super::launch::{Host, shell_single_quote};
use super::{ProcInfo, tr};
use std::process::Command;

/// `/Applications/iTerm.app` from `/Applications/iTerm.app/Contents/MacOS/iTerm2`.
fn bundle_of(process: &ProcInfo) -> Option<String> {
    let path = process.exe.as_deref().unwrap_or(&process.cmd);
    let end = path.find(".app/Contents/")?;
    Some(path[..end + 4].to_owned())
}

fn tty_of(pid: u32) -> Option<String> {
    let output = Command::new("ps")
        .args(["-o", "tty=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let tty = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!tty.is_empty() && tty != "??").then(|| format!("/dev/{tty}"))
}

fn osascript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("-1743") || error.contains("not allowed") {
            Err("macOS demande l’autorisation de piloter le terminal : accepte-la dans Réglages Système › Confidentialité et sécurité › Automatisation, puis réessaie.".into())
        } else {
            Err(error.trim().to_owned())
        }
    }
}

fn applescript_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn bring_forward(chain: &[ProcInfo], project: Option<&str>) -> Result<String, String> {
    let agent = chain
        .first()
        .ok_or_else(|| tr("Processus introuvable.", "Process not found."))?;
    let host = chain
        .iter()
        .find_map(|process| bundle_of(process).map(|bundle| (process, bundle)));
    let Some((_, bundle)) = host else {
        return Err(tr(
            "Impossible de trouver l’application qui héberge cet agent.",
            "Could not find the app hosting this agent.",
        ));
    };
    let app_name = bundle
        .rsplit('/')
        .next()
        .unwrap_or(&bundle)
        .trim_end_matches(".app")
        .to_owned();
    let tty = tty_of(agent.pid);

    match app_name.as_str() {
        "Terminal" => {
            let tty = tty
                .ok_or_else(|| tr("Onglet du terminal introuvable.", "Terminal tab not found."))?;
            let found = osascript(&format!(
                "tell application \"Terminal\"\n repeat with w in windows\n  repeat with t in tabs of w\n   if tty of t is {tty} then\n    set selected of t to true\n    set index of w to 1\n    activate\n    return \"ok\"\n   end if\n  end repeat\n end repeat\nend tell\nreturn \"missing\"",
                tty = applescript_string(&tty)
            ))?;
            if found == "ok" {
                Ok(tr(
                    "Onglet Terminal de l’agent sélectionné.",
                    "Agent’s Terminal tab selected.",
                ))
            } else {
                Err(tr(
                    "Onglet du terminal introuvable.",
                    "Terminal tab not found.",
                ))
            }
        }
        "iTerm" | "iTerm2" => {
            let tty =
                tty.ok_or_else(|| tr("Session iTerm introuvable.", "iTerm session not found."))?;
            let found = osascript(&format!(
                "tell application \"iTerm2\"\n repeat with w in windows\n  repeat with t in tabs of w\n   repeat with s in sessions of t\n    if tty of s is {tty} then\n     select s\n     tell t to select\n     tell w to select\n     activate\n     return \"ok\"\n    end if\n   end repeat\n  end repeat\n end repeat\nend tell\nreturn \"missing\"",
                tty = applescript_string(&tty)
            ))?;
            if found == "ok" {
                Ok(tr(
                    "Session iTerm de l’agent sélectionnée.",
                    "Agent’s iTerm session selected.",
                ))
            } else {
                Err(tr("Session iTerm introuvable.", "iTerm session not found."))
            }
        }
        "Visual Studio Code"
        | "Visual Studio Code - Insiders"
        | "Cursor"
        | "Windsurf"
        | "VSCodium"
        | "Zed" => {
            // Opening the folder focuses the window that already has it open.
            let mut command = Command::new("open");
            command.args(["-a", &bundle]);
            if let Some(project) = project {
                command.arg(project);
            }
            command.status().map_err(|error| error.to_string())?;
            Ok(tr(
                &format!(
                    "{app_name} ouvert sur le projet de l’agent (son terminal intégré y est)."
                ),
                &format!(
                    "{app_name} opened on the agent’s project (its integrated terminal is there)."
                ),
            ))
        }
        _ => {
            Command::new("open")
                .args(["-a", &bundle])
                .status()
                .map_err(|error| error.to_string())?;
            Ok(tr(
                &format!("{app_name} mis au premier plan."),
                &format!("{app_name} brought to the front."),
            ))
        }
    }
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    child
        .stdin
        .take()
        .ok_or("pbcopy")?
        .write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;
    child.wait().map_err(|error| error.to_string())?;
    Ok(())
}

/// Starts `command` in `folder`: typed into a new Terminal / iTerm2 window, or, for an editor,
/// the folder is opened and the command copied for its integrated terminal.
pub fn open_in_host(host: Host, folder: &str, command: &str) -> Result<String, String> {
    let line = format!("cd {} && {command}", shell_single_quote(folder));
    match host {
        Host::Terminal => {
            osascript(&format!(
                "tell application \"Terminal\"\n activate\n do script {}\nend tell",
                applescript_string(&line)
            ))?;
            Ok(tr(
                &format!("Agent relancé dans un nouveau Terminal : {command}"),
                &format!("Agent started again in a new Terminal: {command}"),
            ))
        }
        Host::Iterm => {
            osascript(&format!(
                "tell application \"iTerm2\"\n activate\n set w to (create window with default profile)\n tell current session of w to write text {}\nend tell",
                applescript_string(&line)
            ))?;
            Ok(tr(
                &format!("Agent relancé dans un nouvel iTerm : {command}"),
                &format!("Agent started again in a new iTerm window: {command}"),
            ))
        }
        editor => {
            let app = match editor {
                Host::Cursor => "Cursor",
                Host::Windsurf => "Windsurf",
                _ => "Visual Studio Code",
            };
            Command::new("open")
                .args(["-a", app, folder])
                .status()
                .map_err(|error| error.to_string())?;
            copy_to_clipboard(command)?;
            Ok(tr(
                &format!(
                    "{app} ouvert sur le projet. Commande copiée : colle-la dans son terminal ({command})."
                ),
                &format!(
                    "{app} opened on the project. Command copied: paste it in its terminal ({command})."
                ),
            ))
        }
    }
}
