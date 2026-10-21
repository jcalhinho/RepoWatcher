export type ConnectorKind = "claude" | "codex" | "gemini" | "opencode" | "cursor" | "qwen";

export type Provider = {
  /** Stable UI identifier (React keys, 3D lane ids). */
  id: string;
  /** Provider key serialized by the backend in `SessionEvent.provider` (`Provider::key()` in crates/session-events). */
  eventKey: string;
  name: string;
  initials: string;
  color: string;
  surface: string;
  /** Present when a local connector exists; `scope` is the short source label shown on its card. */
  connector?: { kind: ConnectorKind; scope?: string };
};

/**
 * Agent colours with a local connector come from the validated categorical palette (dark steps,
 * checked for colour-blind separation in `chartProviders` order). Keep them in sync when adding one.
 * Single source of truth for providers: always read `eventKey` to match events, never `id`.
 */
export const providers: Provider[] = [
  { id: "claude_code", eventKey: "claude_code", name: "Claude Code", initials: "C", color: "#d95926", surface: "#3a2219", connector: { kind: "claude" } },
  { id: "codex", eventKey: "codex", name: "Codex", initials: "⌘", color: "#199e70", surface: "#173229", connector: { kind: "codex", scope: "Journaux locaux" } },
  { id: "cursor", eventKey: "cursor", name: "Cursor", initials: "◈", color: "#c98500", surface: "#352a14", connector: { kind: "cursor", scope: "Hooks officiels" } },
  { id: "opencode", eventKey: "opencode", name: "OpenCode", initials: "O", color: "#d55181", surface: "#3a1f2b", connector: { kind: "opencode", scope: "SQLite local" } },
  { id: "copilot", eventKey: "github_copilot", name: "GitHub Copilot", initials: "⌘", color: "#c1b5ff", surface: "#302a43" },
  { id: "gemini", eventKey: "gemini_cli", name: "Gemini CLI", initials: "✳", color: "#3987e5", surface: "#1c2c45", connector: { kind: "gemini", scope: "Journaux locaux" } },
  { id: "qwen", eventKey: "qwen_code", name: "Qwen Code", initials: "Q", color: "#9085e9", surface: "#28264a", connector: { kind: "qwen", scope: "Journaux locaux" } },
  { id: "cline", eventKey: "cline", name: "Cline", initials: "C", color: "#efb477", surface: "#3c3023" },
  { id: "roo", eventKey: "roo_code", name: "Roo Code", initials: "R", color: "#80c99c", surface: "#24382c" },
  { id: "continue", eventKey: "continue", name: "Continue", initials: "↳", color: "#c0c7d4", surface: "#30343c" },
  { id: "aider", eventKey: "aider", name: "Aider", initials: "A", color: "#f18e8e", surface: "#402727" }
];

export function providerById(id: string): Provider {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown provider id: ${id}`);
  return provider;
}

/** Lane order of the sprint track. */
export const raceProviders: Provider[] = ["claude_code", "codex", "opencode", "gemini", "cursor", "qwen"].map(providerById);

/**
 * Series order for charts. This exact order passed the categorical palette checks
 * (adjacent CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.3 on #171b22): do not reorder casually.
 */
export const chartProviders: Provider[] = ["gemini", "claude_code", "codex", "cursor", "opencode", "qwen"].map(providerById);
