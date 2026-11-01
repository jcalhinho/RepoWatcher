# Contributing to Agent Observer

Thanks for helping! This project lives on small, careful contributions: a bug report with
the right details, a sourced model price, a new connector, a translation, a fix.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security
issues go through [SECURITY.md](SECURITY.md), never through a public issue.

## Ways to help

- **Report a bug** — use the bug form; the OS, agent and app version matter a lot here.
- **Ask for a connector** — tell us how the agent exposes its activity (hooks, logs, database).
- **Fix a model price** — with a link to the provider's official pricing page.
- **Translate** — the UI is in French today; English localisation is the first goal.
- **Code** — pick an issue labelled `good first issue` or `help wanted`, or open an issue
  first for anything larger than a small fix, so we can agree on the approach.

## Development setup

You need:

- [Node.js 22](https://nodejs.org/) and npm
- [Rust](https://rustup.rs/) stable, 1.85 or later, with `rustfmt` and `clippy`
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Microsoft C++ Build Tools (*Desktop development with C++*) and WebView2
  - **Linux (Debian/Ubuntu):**
    ```bash
    sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential
    ```

Then:

```bash
npm ci
npm run desktop:dev
```

The app opens with hot reload for the UI; Rust changes trigger a rebuild.

> Only one instance can hold the collector port (`127.0.0.1:43821`). Quit any installed copy
> of Agent Observer before running the development build.

## Checks to run before a pull request

CI runs the same commands on macOS, Windows and Linux:

```bash
npm run desktop:typecheck                                    # TypeScript
npx vitest run apps/desktop                                  # UI logic tests
npm run build --workspace @repo-watcher/agent-observer-desktop   # front-end build (needed by the Rust build)
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

The Rust crate of the desktop app embeds the built front-end, so build it once before
`cargo clippy` / `cargo test`, otherwise the build stops with *"frontendDist … doesn't exist"*.

## Code style

- **Rust:** `rustfmt` defaults and a clean `clippy -D warnings`. Errors are handled, not
  `unwrap()`ped, outside tests.
- **TypeScript:** strict mode, no `any`. Keep pure logic (statuses, analytics, pricing,
  workspace matching) in plain `.ts` modules with Vitest tests next to them, and keep React
  components thin.
- **Comments** explain *why*, not what. Match the density of the surrounding code.
- **UI copy** is French for now and addresses the user as *tu*. Say what something means in
  plain words; never show a number the app does not actually have.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(desktop): …`, `fix: …`, `docs: …`). One logical change per commit.

## The rules that make this project trustworthy

These are non-negotiable, and reviews check them first:

1. **Local only.** No telemetry, no network calls, no remote fonts or scripts. The only
   listener is the loopback collector.
2. **Observe, never act.** Never write to an agent's files, settings or database, and never
   write to a user's repository. Open databases read-only.
3. **Never persist private content.** Agent responses, reasoning, tool outputs and file
   contents are dropped before storage. Prompt text and command text are stored only behind
   their existing opt-in switches.
4. **Never invent data.** If an agent does not report a value, leave the field empty
   (`None`) and let the UI say *not provided*. Values computed by the app are marked with
   their origin (`DataOrigin::Derived` / `Estimated`).
5. **Never attribute Git changes to an agent** without evidence from the agent itself.

## Adding a connector

There are two paths.

### Through the local HTTP API (no Rust needed)

The local HTTP API lets any script, hook or plugin post events to the running app. Its
contract — endpoints, authentication, event schema, examples — is documented in
[`docs/CONNECTORS.md`](docs/CONNECTORS.md). This is the preferred way to support a new agent
quickly, and connectors written this way can live in their own repository.

### As a native Rust connector

For agents whose activity can be read from local files or a database:

1. **Provider** — if the agent is new, add it to `Provider` in
   `crates/session-events/src/lib.rs` (with its stable `key()`), and to `providers` in
   `apps/desktop/src/ui/providers.ts` with the same `eventKey`.
2. **Module** — add `apps/desktop/src-tauri/src/<agent>_sessions.rs`, modelled on
   `qwen_sessions.rs` (JSONL logs) or `opencode_sessions.rs` (SQLite, read-only). It must:
   - locate the agent's data directory on macOS, Windows and Linux, honouring the agent's
     own environment variables;
   - start at the end of existing files and read appended records only;
   - produce `SessionEvent`s with stable `event_id`s where the source allows it
     (`Uuid::new_v5` from the record's identity), so re-reading a record never duplicates it;
   - apply the capture policy for prompts and commands, and drop everything else private.
3. **Wiring** — spawn the monitor in `main.rs` next to the others, and add a
   `<agent>_setup` command (like `qwen_setup`) so the Connectors tab can show whether the
   agent was detected.
4. **Tests** — unit tests with small, anonymised fixture records covering: a normal turn,
   a tool failure, token usage, a truncated last line, and a record with private content
   that must **not** be persisted.
5. **Docs** — add the agent to the *Supported agents* table in both READMEs.

## Adding or fixing a model price

Prices live in [`apps/desktop/src/ui/pricing.ts`](apps/desktop/src/ui/pricing.ts) and drive
the *estimated* cost.

- Use only the provider's **official** pricing page. Put its URL in `source` and the date you
  read it in `checkedOn` (`YYYY-MM-DD`).
- Prices are USD per million tokens, standard tier (not batch, not priority).
- Add cache prices only if the provider publishes them and the connector reports cache
  tokens separately.
- Never add a guessed or "probably the same as" price: a model missing from the table simply
  shows no cost, which is the honest answer.
- Run `npx vitest run apps/desktop` — the pricing tests in `sessionSummary.test.ts` check
  ids, normalisation and cost estimates.

## Pull requests

- Keep them focused; split refactors from behaviour changes.
- Fill in the template, including what you tested and on which OS.
- UI changes: add a screenshot or a short GIF.
- Update `CHANGELOG.md` under **Unreleased** for anything a user would notice.
- A maintainer reviews within a few days. Be patient and kind — everyone here volunteers.

## Releases (maintainers)

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`,
   `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/package.json`, then
   `cargo check` to refresh `Cargo.lock`.
2. Move **Unreleased** to the new version in `CHANGELOG.md`.
3. Tag `vX.Y.Z` and push the tag. The *Release* workflow builds the macOS and Windows
   installers, writes `SHA256SUMS.txt` and opens a **draft** GitHub Release.
4. Check the draft, test an installer on each platform, then publish it.
