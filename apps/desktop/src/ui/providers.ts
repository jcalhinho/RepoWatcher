import { useSyncExternalStore } from "react";

export type ConnectorKind = "claude" | "codex" | "gemini" | "opencode" | "qwen";

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
 * checked for colour-blind separation in `activeProviders` order). Keep them in sync when adding one.
 * Single source of truth for providers: always read `eventKey` to match events, never `id`.
 */
export const providers: Provider[] = [
  { id: "claude_code", eventKey: "claude_code", name: "Claude Code", initials: "C", color: "#d95926", surface: "#3a2219", connector: { kind: "claude" } },
  { id: "codex", eventKey: "codex", name: "Codex", initials: "⌘", color: "#199e70", surface: "#173229", connector: { kind: "codex", scope: "Journaux locaux" } },
  { id: "cursor", eventKey: "cursor", name: "Cursor", initials: "◈", color: "#c98500", surface: "#352a14" },
  { id: "opencode", eventKey: "opencode", name: "OpenCode", initials: "O", color: "#d55181", surface: "#3a1f2b", connector: { kind: "opencode", scope: "SQLite local" } },
  { id: "copilot", eventKey: "github_copilot", name: "GitHub Copilot", initials: "⌘", color: "#c1b5ff", surface: "#302a43" },
  { id: "gemini", eventKey: "gemini_cli", name: "Gemini CLI", initials: "✳", color: "#3987e5", surface: "#1c2c45", connector: { kind: "gemini", scope: "Journaux locaux" } },
  { id: "qwen", eventKey: "qwen_code", name: "Qwen Code", initials: "Q", color: "#9085e9", surface: "#28264a", connector: { kind: "qwen", scope: "Journaux locaux" } },
  { id: "cline", eventKey: "cline", name: "Cline", initials: "C", color: "#efb477", surface: "#3c3023" },
  { id: "roo", eventKey: "roo_code", name: "Roo Code", initials: "R", color: "#80c99c", surface: "#24382c" },
  { id: "continue", eventKey: "continue", name: "Continue", initials: "↳", color: "#c0c7d4", surface: "#30343c" },
  { id: "aider", eventKey: "aider", name: "Aider", initials: "A", color: "#f18e8e", surface: "#402727" },
  // Placeholder for the backend key; each custom connector becomes its own provider at runtime.
  { id: "custom", eventKey: "custom", name: "Custom connector", initials: "+", color: "#7d8aa3", surface: "#262b35" }
];

export function providerById(id: string): Provider {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown provider id: ${id}`);
  return provider;
}

/**
 * Agents shown by the app for now, in chart series order. This exact order passed the categorical
 * palette checks (adjacent CVD ΔE ≥ 16, normal-vision ΔE ≥ 15 on #171b22): re-run the validator
 * before reordering or adding one. Other providers stay in the table (backend keys) but are hidden.
 */
export const activeProviders: Provider[] = ["claude_code", "gemini", "codex", "qwen", "opencode"].map(providerById);

/*
 * Custom connectors (open HTTP API) are providers too, keyed `custom:<connector id>`. They are kept
 * in a small store so every view re-renders when one is added or removed.
 */
let customProviders: Provider[] = [];
let agents: Provider[] = activeProviders;
let version = 0;
const listeners = new Set<() => void>();

export type CustomConnectorInfo = { id: string; name: string; color: string };

export function setCustomProviders(connectors: CustomConnectorInfo[]) {
  customProviders = connectors.map((connector) => ({
    id: `custom:${connector.id}`,
    eventKey: `custom:${connector.id}`,
    name: connector.name,
    initials: connector.name.trim().charAt(0).toUpperCase() || "+",
    color: connector.color,
    surface: "#262b35"
  }));
  agents = customProviders.length ? [...activeProviders, ...customProviders] : activeProviders;
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Every agent the app shows: the built-in ones, then custom connectors (chart and lane order). */
export function activeAgents(): Provider[] {
  return agents;
}

/** Re-renders the calling component when custom connectors change; returns the agents. */
export function useAgents(): Provider[] {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version);
  return activeAgents();
}

export function providerFor(eventKey: string): Provider | undefined {
  return eventKey.startsWith("custom:") ? customProviders.find((provider) => provider.eventKey === eventKey) : providers.find((provider) => provider.eventKey === eventKey);
}

export function agentName(eventKey: string) {
  return providerFor(eventKey)?.name ?? eventKey;
}

/** Events worth showing. Custom keys always pass: connectors may load after the first events. */
export function isActiveProvider(eventKey: string) {
  return eventKey.startsWith("custom:") || activeProviders.some((provider) => provider.eventKey === eventKey);
}

/** Events of custom connectors are stored as provider `custom` + `agent`; the UI keys them `custom:<agent>`. */
export function normalizeEvent<T extends { provider: string; agent?: string | null }>(event: T): T {
  return event.provider === "custom" && event.agent ? { ...event, provider: `custom:${event.agent}` } : event;
}
