export type ConnectorKind = "claude" | "codex" | "gemini" | "opencode" | "cursor";

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

/** Single source of truth for providers: always read `eventKey` to match events, never `id`. */
export const providers: Provider[] = [
  { id: "claude_code", eventKey: "claude_code", name: "Claude Code", initials: "C", color: "#e59b6b", surface: "#3a2921", connector: { kind: "claude" } },
  { id: "codex", eventKey: "codex", name: "Codex", initials: "⌘", color: "#76d6ae", surface: "#1d342d", connector: { kind: "codex", scope: "Journaux locaux" } },
  { id: "cursor", eventKey: "cursor", name: "Cursor", initials: "◈", color: "#8cc9ff", surface: "#1f3040", connector: { kind: "cursor", scope: "Hooks officiels" } },
  { id: "opencode", eventKey: "opencode", name: "OpenCode", initials: "O", color: "#8dc8c1", surface: "#203633", connector: { kind: "opencode", scope: "SQLite local" } },
  { id: "copilot", eventKey: "github_copilot", name: "GitHub Copilot", initials: "⌘", color: "#c1b5ff", surface: "#302a43" },
  { id: "gemini", eventKey: "gemini_cli", name: "Gemini CLI", initials: "✳", color: "#9db9ff", surface: "#252f49", connector: { kind: "gemini", scope: "Journaux locaux" } },
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
export const raceProviders: Provider[] = ["claude_code", "codex", "opencode", "gemini", "cursor"].map(providerById);
