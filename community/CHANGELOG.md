# Changelog

All notable changes to Agent Observer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-21

<!-- Set the date to the day the v0.1.0 tag is pushed. -->

First public version.

### Added

- **Desktop app** for macOS and Windows, built with Tauri 2 and React: a local collector on
  `127.0.0.1:43821` protected by a per-installation bearer token, and a local SQLite event
  store.
- **Connectors** for five agents:
  - Claude Code through its official HTTP hooks, plus provider-reported token usage
    (including cache reads and writes) from its session transcripts;
  - Codex from its JSONL rollout logs;
  - Gemini CLI from its local chat records;
  - OpenCode from its SQLite database, opened read-only;
  - Qwen Code from its JSONL chat records.
- A Cursor hooks connector in the native runtime, hidden from the interface for now.
- **Agent cards** that put the agents needing you first, with plain-language statuses
  (blocked, silent, waiting for you, working, idle, not seen yet) and a narration of what
  each agent is doing.
- **Mini mode**: a compact, optionally always-on-top column of agent cards in a corner of the
  screen.
- **Race**: a low-poly 3D stadium where each agent runs on a 100 m track, hopping on events,
  falling on failed tools and finishing at the end of a turn, with speech bubbles; respects
  reduced motion.
- **Analytics** over 15 minutes, 1 hour, 24 hours or the whole history: event rate, tool
  calls and failures, input/output/cache tokens by agent and model.
- **Estimated cost** per session for models with a sourced public price (Claude models),
  always labelled as an estimate.
- **Workspaces**: a folder of Git repositories (up to four levels deep) or a VS Code
  `.code-workspace` file; events attached to their repository, worktrees included; a
  repositories table with branch, ahead/behind, uncommitted changes and agent activity; a
  per-repository filter.
- **Sessions**: every observed session with an end-of-session summary (duration, turns,
  tools, failures, tokens, estimated cost, commits in the session window) and its full event
  timeline, with paging through older events.
- **Settings**: opt-in capture of prompt text and of agent commands (both off by default),
  event retention from 7 days to forever with hourly purge, JSON export and erase of the
  local history.
- In-app help explaining every status, number and term; resizable and full-screen dashboard
  sections.
- Single-instance app: a second launch brings the running window forward.
- macOS `.app` / `.dmg` and Windows NSIS / MSI bundles; `npm run desktop:install-mac` for a
  local macOS install.

### Security

- Workspaces, Git repositories and agent databases are only ever read, never written.
- Agent responses, reasoning, tool outputs and file contents are never persisted.

[Unreleased]: https://github.com/jcalhinho/agent-observer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jcalhinho/agent-observer/releases/tag/v0.1.0
