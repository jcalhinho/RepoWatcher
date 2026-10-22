# RepoWatcher Agent Observer desktop app

The desktop shell is built with Tauri 2, React, and Vite. Its native Rust
runtime shares the root Cargo workspace with `crates/session-events`.

## Run locally

From the repository root:

```sh
npm ci
npm run desktop:dev
```

## Build a Windows installer

On Windows, install Node.js LTS, Rust with the MSVC toolchain, and Microsoft
C++ Build Tools with **Desktop development with C++**. WebView2 is included on
current Windows installations and can be installed by the Tauri bundle when
needed. MSI packaging may also require the Windows optional VBScript feature.

Then, from the repository root:

```powershell
npm ci
npm run desktop:typecheck
npm run desktop:build
```

The Tauri bundle is configured to produce NSIS setup and MSI installers. Use
the NSIS setup executable on a personal PC: it installs for the current user
without administrator rights. On an organization-managed PC, software policy
may still require IT approval; the MSI can be handed to IT for managed
distribution.

## Current implementation boundary

For now the interface shows five agents: Claude Code, Codex, Gemini CLI,
OpenCode and Qwen Code. The Cursor connector remains in the native runtime but is
hidden, and its events are ignored by the interface.

The app currently supports six local connectors: Claude Code through its
documented HTTP hooks, Codex, Gemini CLI and Qwen Code through their local
session logs, OpenCode through its local SQLite database in read-only mode, and
Cursor through its documented user hooks. These are six implemented integrations, not
universal coverage of every coding agent; GitHub Copilot, Cline, Roo Code,
Continue, and Aider are not connected. Claude Code and Cursor hook setup is
shown in-app; Codex, Gemini and Qwen Code are detected without editing their settings.
The app listens only on `127.0.0.1:43821`, authenticates requests with a
generated local bearer token, and exposes a settings fragment for the user to
merge manually into Claude Code's user settings (`~/.claude/settings.json`, or
`%USERPROFILE%\\.claude\\settings.json` on Windows). It does not overwrite
Claude settings. Cursor's user hook fragment is likewise displayed for manual
merge into `~/.cursor/hooks.json`; it uses a local PowerShell command on Windows
and Python 3 on macOS/Linux to forward hook JSON to the authenticated loopback
endpoint. Generate and apply a separate fragment on each PC: the local
authentication token is installation-specific. Cursor's configured hooks are
post-action observers and do not participate in permission decisions.

The live view receives prompt-submitted, tool-started/tool-finished/tool-failed,
turn-stop, and session-end metadata. By default, prompt and shell-command text,
tool output, and transcript paths are discarded before persistence. Separate
opt-ins can retain prompt text and Bash/PowerShell commands because they may
contain secrets or confidential content. Tool output and transcript paths are
always excluded. Events are stored locally in SQLite under the operating
system's app-data directory. The dashboard shows a rolling event-rate chart,
per-session drill-down, and combines observed file paths with the selected
repository's current Git status and recent commits. Git changes are not
attributed to an agent without evidence. The Sessions view can page through
older stored events and export the full local event database as JSON to a path
chosen in the native save dialog. Exported prompts and commands are included
only if their corresponding capture options were enabled when recorded.

The overview renders every event in the currently loaded page (up to 500),
with wrapping rather than visual ellipses. Sessions can page through older
events, and each event has a “Journal complet” disclosure showing the complete
persisted JSON. Tool stdout/results are not shown because they are deliberately
discarded before persistence.

The overview's 100 m agent track animates each newly observed event: events
trigger a hop, tool failures trigger a fall/recovery, and explicit turn/session
completion signals move the runner to the finish. Claude Code and Codex expose
turn-stop/completion markers; OpenCode, Gemini CLI, and Cursor can expose
activity without a reliable model-generation boundary, so their lanes are
labelled “signal récent” rather than claiming a confirmed running state. Track
distance is a visual activity indicator, never a model-completion percentage.
The animation respects the operating system's reduced-motion preference.

Codex is supported by following appended JSONL rollout records under
`%USERPROFILE%\\.codex\\sessions` (or `$HOME/.codex/sessions`; `CODEX_HOME` is
respected). No Codex settings are edited. At startup, the monitor seeks to the
end of currently active files and observes new records only; it does not
import prior history. It records session/turn checkpoints, tool names, safe
file-path metadata, and provider-reported `last_token_usage` input/output
counts. Command text and user prompt text are separately opt-in. Tool outputs,
assistant responses, and reasoning are never persisted. Codex counters describe
the provider's last model request, not an inferred monetary cost.

A workspace replaces the single selected repository. Choose either a folder,
in which every Git repository up to four levels deep is found (dependency and
build folders are skipped), or a VS Code `.code-workspace` file, whose listed
folders are used (comments and trailing commas are accepted; missing folders
are reported). Each event is attached to the deepest repository containing its
project or file path; paths outside every repository are resolved with
`git rev-parse --git-common-dir`, so a worktree counts for the clone it belongs
to, and Gemini CLI events match by project-path hash. A filter row scopes the
race, charts and activity feed to one repository or to events outside the
workspace. The repositories table shows branch, commits ahead/behind upstream,
uncommitted changes, agents seen and active, and last activity side by side;
Git changes are never attributed to an agent. Repositories with recent agent
activity are refreshed every 5 seconds, the others every minute. The workspace
is observed read-only.

Qwen Code is supported by following appended JSONL chat records under
`%USERPROFILE%\\.qwen\\projects\\<project>\\chats` (or
`$HOME/.qwen/projects/<project>/chats`). No Qwen settings are edited. At
startup, the monitor seeks to the end of chats active in the last 48 hours and
observes new records only; it does not import prior history. It records session
start, user prompts (text opt-in), tool start/finish/failure with tool names and
file paths (command text opt-in), turn results with their duration, and the
provider-reported input/output token counts, model and latency of each API
response. Assistant text, thoughts, tool outputs and API response text are never
persisted.

Gemini CLI is observed from local chat records under
`%USERPROFILE%\.gemini\tmp` (or `$HOME/.gemini/tmp`; `GEMINI_CLI_HOME` is
respected). Existing files are positioned at their end when monitoring starts;
newly created session files are observed from their beginning. Older messages
are not imported. Gemini records can include prompts, model output, and tool
results: output/thoughts and tool results are discarded, while prompts and
commands follow the same opt-in privacy switches. Input/output token counts
are shown only when present in the provider record. A project hash associates
Gemini sessions with the selected repository without needing to expose the
working directory in the event.

Claude's `PostToolUse` hook exposes token fields for completed foreground
subagents (`Agent` tool responses), but those figures cover the final request
only, not the overall subagent run or parent session. The app labels and sums
only those observed partial values; overall session token totals remain
unavailable rather than estimated. Search,
richer commit/diff attribution and the six additional integrations listed above
remain unimplemented. Complete transcript and tool-output capture are
intentionally excluded by the privacy model. Codex and Gemini history before
RepoWatcher starts is not backfilled; usage fields remain limited to values
present in their local session streams.

OpenCode is observed from `opencode*.db` in the provider's local data directory
(`%USERPROFILE%\.local\share\opencode` on Windows, `$XDG_DATA_HOME/opencode`
when configured, or `$HOME/.local/share/opencode` by default). `OPENCODE_DB`
can point to a specific database; `OPENCODE_DATA_DIR` can override the data
directory. RepoWatcher opens the database read-only and polls the
`session_message` and `session_v2` tables,
including updates visible through SQLite's WAL. It does not start an OpenCode
server, edit OpenCode settings, or import the existing transcript at startup.
New user messages, tool lifecycle metadata, project directory, and provider
token counts are collected when present. Prompt text and command input follow
the shared opt-in switches; assistant text, reasoning, tool output, and tool
results are never stored. Exact token semantics depend on the fields OpenCode
records for each message.

Cursor's user hooks cover session start/end, successful and failed tool
metadata, shell-command completion, file edits, and agent-loop stop events.
The configuration is manual and opt-in; a Cursor session must run while Agent
Observer is open to receive events. Tool outputs, edit contents, prompts,
assistant responses, transcript paths, user identity, and thinking text are
excluded. Shell/tool command strings are retained only with the shared
command-capture preference enabled. Cursor hooks do not document token usage,
so its token charts remain blank rather than estimated.

## Windows build from this repository

The `Build Agent Observer for Windows` workflow runs on `windows-latest` after
relevant pushes to `agent-observer/windows-release`. It produces NSIS `.exe`
and MSI `.msi` installers as a downloadable workflow artifact retained for 30
days. Each run installs frontend dependencies, type-checks the UI, builds the
frontend assets, runs the Rust connector tests, then builds and hashes both
installers. The Windows build containing the current UI and log-readability
updates and live 100 m event track completed successfully on 2026-10-20. The
workflow type-checks and tests the provider race-state transitions before
packaging. Download its
[`repowatcher-agent-observer-windows-x64` artifact](https://github.com/jcalhinho/RepoWatcher/actions/runs/39500655847/artifacts/12301760385)
from the successful [Actions run](https://github.com/jcalhinho/RepoWatcher/actions/runs/39500655847).
The artifact is retained for 30 days. On a fresh checkout, use the dedicated
branch:

```sh
git fetch origin agent-observer/windows-release
git switch --track origin/agent-observer/windows-release
```

For later runs, open the repository's **Actions** tab, select
**Build Agent Observer for Windows**, open the completed run, and download
`repowatcher-agent-observer-windows-x64`. Extract the ZIP; it contains the
NSIS setup in `nsis/`, the MSI in `msi/`, and `installer-sha256.txt`. In
PowerShell, verify that the downloaded installers match the manifest:

```powershell
$expected = @{}
Get-Content .\installer-sha256.txt | ForEach-Object {
  $parts = $_ -split '\s+', 2
  $expected[$parts[1].Replace('/', '\')] = $parts[0]
}
foreach ($path in $expected.Keys) {
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected[$path]) { throw "SHA-256 mismatch: $path" }
}
Write-Output 'Installers verified.'
```

Run the `*-setup.exe` installer in `nsis/`. It is configured for the current
Windows user and does not request administrator rights. Windows 10/11 normally
already includes WebView2; the installer can fetch its bootstrapper if the
runtime is missing.
On a managed work PC, follow company software policy if SmartScreen or endpoint
protection blocks the unsigned initial build; ask IT to distribute the MSI if
required rather than bypassing those controls. After launch, configure Claude
Code from the in-app instructions. Codex, Gemini CLI and OpenCode are detected
from their existing local records without changing their settings. On Windows,
OpenCode's database is normally under `%USERPROFILE%\.local\share\opencode`.

For local builds from source, see the prerequisites above.
