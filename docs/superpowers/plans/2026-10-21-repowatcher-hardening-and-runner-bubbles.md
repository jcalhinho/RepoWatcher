# RepoWatcher hardening and runner bubbles

## Goal

Address the concrete review findings in the repository and add short, human-readable activity bubbles above live runners. Preserve the current Windows release branch and the existing generated Tauri schema changes.

## Scope and design

- Keep repository reads and writes inside the selected repository after resolving filesystem links.
- Reject patching files whose full contents exceed the endpoint's supported limit; never hash a prefix and overwrite the complete file.
- Keep the exploration API loopback-only, including when `HOST` is set.
- Remove commands that execute repository scripts from the agent's default command allowlist; retain bounded read-only commands.
- Parse ripgrep JSON output so Windows drive letters and colons in file names remain intact.
- Restrict OpenCode polling to recently changed rows and prune deduplication state.
- Render a brief French action summary in a speech bubble on the live runner. Build copy only from observed event kind, tool category, and file path; never show raw command or output text.
- Upgrade only compatible npm dependency versions needed to clear the current audit findings.
- Present RepoWatcher as one compact workspace without a permanent side menu. Keep the race, key indicators, recent activity, connector status, and selected repository visible together; open the full session history, repository map, connector setup, and preferences in dialogs where useful.

## Implementation sequence

1. Add regression tests for symlink escapes, oversized patch targets, non-loopback binding, script command policy, ripgrep JSON parsing, OpenCode polling cursor retention, and action-summary copy.
2. Implement each fix in the smallest owning module and run its focused tests.
3. Run the full JavaScript suite after building the shared core workspace; run the Rust connector suite and desktop typecheck/build.
4. Apply compatible npm audit updates and confirm `npm audit` is clear.
5. Review the complete diff, preserve the pre-existing generated schema files, commit the changes, and push `agent-observer/windows-release`.
6. Refactor desktop navigation into a single-screen workspace and move secondary detail views into accessible dialogs.

## Task 6: Single-screen desktop workspace

In `apps/desktop/src/ui/App.tsx` and `apps/desktop/src/ui/styles.css`, remove the fixed left sidebar and replace it with a compact top workspace bar. Keep the main dashboard usable in a single desktop viewport: agent race and activity bubbles, essential metrics, recent activity, connector state, selected repository, and collection status should remain visible together without making the user navigate away. Put full session history, repository map details, connector setup actions, and preferences/help in accessible dialogs that can be opened from the top bar or dashboard. Keep repository selection, data privacy controls, and all existing connector setup flows working. Preserve responsive behavior and the existing dark visual language. Do not expose raw captured logs in the runner bubbles.

Files in scope: `apps/desktop/src/ui/App.tsx`, `apps/desktop/src/ui/styles.css`, `apps/desktop/src/ui/SprintTrack3D.tsx`, `apps/desktop/src/ui/activity-copy.ts`, `apps/desktop/src/ui/activity-copy.test.ts`, and `apps/desktop/package.json`. The latter three are already changed for the activity bubble request; keep those changes intact.

## Review focus

- Windows path canonicalization and path separator behavior.
- Existing-file and missing-file patch semantics, including byte-size checks.
- Ensure loopback-only validation does not reject IPv4/IPv6 loopback spellings.
- Keep manual/LLM command policy consistent with README and system prompt.
- Ensure polling deduplication remains correct when provider rows update.
- Ensure bubbles do not claim work that event metadata cannot establish and disappear after a short interval.
