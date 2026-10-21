//! Starting an agent again when its process is gone: which command resumes its session, and in
//! which terminal or editor to run it. Pure helpers live here (tested); opening the window is
//! platform code in `macos.rs` / `windows.rs`.

use super::ProcInfo;

/// The command that resumes an agent's session in its project folder. A session id that does not
/// look like an id is never put on a command line.
pub fn resume_command(provider: &str, session_id: Option<&str>) -> Option<String> {
    let id = session_id.filter(|id| {
        !id.is_empty()
            && id.len() <= 100
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    });
    Some(match (provider, id) {
        ("claude_code", Some(id)) => format!("claude --resume {id}"),
        ("claude_code", None) => "claude --continue".into(),
        ("codex", Some(id)) => format!("codex resume {id}"),
        ("codex", None) => "codex resume --last".into(),
        ("gemini_cli", _) => "gemini --resume".into(),
        ("qwen_code", _) => "qwen --continue".into(),
        ("opencode", Some(id)) => format!("opencode --session {id}"),
        ("opencode", None) => "opencode --continue".into(),
        _ => return None,
    })
}

/// A word to put between single quotes in a POSIX shell.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Terminals and editors an agent can be started in, as the UI names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    Terminal,
    Iterm,
    Code,
    Cursor,
    Windsurf,
}

impl Host {
    pub fn parse(value: &str) -> Option<Host> {
        Some(match value {
            "terminal" => Host::Terminal,
            "iterm" => Host::Iterm,
            "code" => Host::Code,
            "cursor" => Host::Cursor,
            "windsurf" => Host::Windsurf,
            _ => return None,
        })
    }

    /// Editors cannot be told to run a command in their terminal: the command is copied instead.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub fn is_editor(self) -> bool {
        matches!(self, Host::Code | Host::Cursor | Host::Windsurf)
    }
}

/// The terminal or editor an agent process lives in, read from its ancestors.
pub fn host_of(chain: &[ProcInfo]) -> Option<Host> {
    chain.iter().find_map(|process| {
        let text = format!(
            "{} {}",
            process.exe.as_deref().unwrap_or_default(),
            process.name
        )
        .to_lowercase();
        if text.contains("iterm") {
            Some(Host::Iterm)
        } else if text.contains("terminal.app") || text.contains("windowsterminal") {
            Some(Host::Terminal)
        } else if text.contains("cursor") {
            Some(Host::Cursor)
        } else if text.contains("windsurf") {
            Some(Host::Windsurf)
        } else if text.contains("visual studio code") || text.ends_with("code.exe") {
            Some(Host::Code)
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(exe: &str) -> ProcInfo {
        ProcInfo {
            pid: 1,
            parent: None,
            name: exe.rsplit('/').next().unwrap().to_owned(),
            cmd: String::new(),
            exe: Some(exe.to_owned()),
            cwd: None,
            start_time: 0,
        }
    }

    #[test]
    fn resumes_each_agent_in_its_own_way() {
        assert_eq!(
            resume_command("claude_code", Some("abc-123")).as_deref(),
            Some("claude --resume abc-123")
        );
        assert_eq!(
            resume_command("codex", Some("0199-aa")).as_deref(),
            Some("codex resume 0199-aa")
        );
        assert_eq!(
            resume_command("opencode", Some("ses_1")).as_deref(),
            Some("opencode --session ses_1")
        );
        assert_eq!(resume_command("custom:x", Some("a")), None);
    }

    #[test]
    fn never_puts_a_suspicious_session_id_on_a_command_line() {
        for bad in ["a; rm -rf ~", "$(whoami)", "a b", "a`b`", ""] {
            assert_eq!(
                resume_command("claude_code", Some(bad)).as_deref(),
                Some("claude --continue"),
                "{bad}"
            );
        }
    }

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(shell_single_quote("/a b/c"), "'/a b/c'");
        assert_eq!(shell_single_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn recognises_the_host_of_an_agent() {
        let chain = [
            process("/opt/homebrew/bin/codex"),
            process("/Applications/iTerm.app/Contents/MacOS/iTerm2"),
        ];
        assert_eq!(host_of(&chain), Some(Host::Iterm));
        let chain = [process("/Applications/Cursor.app/Contents/MacOS/Cursor")];
        assert_eq!(host_of(&chain), Some(Host::Cursor));
        let chain = [process(
            "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
        )];
        assert_eq!(host_of(&chain), Some(Host::Code));
        assert_eq!(host_of(&[process("/bin/zsh")]), None);
    }
}
