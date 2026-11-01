## What and why

<!-- What does this change, and why? Link the issue it closes: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New connector or connector change
- [ ] Model price
- [ ] New feature / UI change
- [ ] Documentation, CI or tooling

## How I tested it

<!-- Commands run, agents used, what you clicked. -->

Tested on:

- [ ] macOS
- [ ] Windows
- [ ] Linux (from source)

## Screenshots

<!-- For UI changes: before / after, or a short GIF. Redact private paths and prompts. -->

## Checklist

- [ ] `npm run desktop:typecheck` and `npx vitest run apps/desktop` pass
- [ ] `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` pass
- [ ] Nothing new is sent over the network, and nothing private (agent responses, reasoning, tool outputs, file contents) is persisted
- [ ] Values the agent does not report are left empty, not guessed; derived or estimated values are marked as such
- [ ] New model prices cite the provider's official pricing page and the date it was read
- [ ] `CHANGELOG.md` updated under **Unreleased** if users will notice the change
- [ ] Both READMEs updated if a supported agent, setting or install step changed
