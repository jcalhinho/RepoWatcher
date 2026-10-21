import { describe, expect, it } from "vitest";
import { findModelPrice, normalizeModelId } from "./pricing";
import { estimateCost, isPossiblyTruncated, sessionMatchesRepository, summarizeSession, type SummaryEvent } from "./sessionSummary";

const baseTime = Date.parse("2026-10-20T12:00:00.000Z");
let counter = 0;

function event(provider: string, kind: string, seconds: number, extra: Partial<SummaryEvent> = {}): SummaryEvent {
  counter += 1;
  return {
    event_id: `event-${counter}`,
    session_id: "session-1",
    occurred_at: new Date(baseTime + seconds * 1000).toISOString(),
    provider,
    kind,
    ...extra
  };
}

const provider = <T,>(value: T) => ({ value, origin: "provider" });

describe("session summary", () => {
  it("returns null for an empty session", () => {
    expect(summarizeSession([])).toBeNull();
  });

  it("derives duration, turns, tools, failures and files from a Claude session", () => {
    const events = [
      event("claude_code", "user_message", 0, { project_path: "C:\\work\\repo" }),
      event("claude_code", "tool_started", 5, { tool_name: "Read", file_path: "C:\\work\\repo\\src\\main.ts" }),
      event("claude_code", "tool_finished", 6, { tool_name: "Read", file_path: "C:\\work\\repo\\src\\main.ts" }),
      event("claude_code", "tool_started", 10, { tool_name: "Bash" }),
      event("claude_code", "tool_failed", 12, { tool_name: "Bash", outcome: "failed" }),
      event("claude_code", "checkpoint", 20),
      event("claude_code", "user_message", 60),
      event("claude_code", "checkpoint", 90)
    ];
    // Input order must not matter.
    const summary = summarizeSession([...events].reverse())!;
    expect(summary.duration).toEqual({ value: 90_000, origin: "derived" });
    expect(summary.startedAt).toBe(events[0].occurred_at);
    expect(summary.turns).toEqual({ count: 2, basis: "user_message" });
    expect(summary.tools).toEqual([
      { name: "Bash", count: 1, failed: 1 },
      { name: "Read", count: 1, failed: 0 }
    ]);
    expect(summary.failures).toEqual({ count: 1, tools: ["Bash"] });
    expect(summary.files).toEqual([{ path: "src/main.ts", events: 2, changed: false, tools: ["Read"] }]);
    expect(summary.tokens).toBeNull();
    expect(summary.models).toEqual([]);
    expect(summary.cost).toBeNull();
    expect(summary.reportedDuration).toBeNull();
  });

  it("counts Codex turns from turn-started markers rather than user messages", () => {
    const summary = summarizeSession([
      event("codex", "session_started", 0, { outcome: "turn-started:t1" }),
      event("codex", "user_message", 1),
      event("codex", "user_message", 2),
      event("codex", "checkpoint", 30, { outcome: "turn-complete:t1" }),
      event("codex", "checkpoint", 40, { outcome: "turn-started:t2" })
    ])!;
    expect(summary.turns).toEqual({ count: 2, basis: "codex_turn_started" });
  });

  it("counts Cursor turns from stop checkpoints and keeps the reported session duration", () => {
    const summary = summarizeSession([
      event("cursor", "session_started", 0),
      event("cursor", "tool_finished", 3, { tool_name: "Shell" }),
      event("cursor", "file_changed", 4, { file_path: "/repo/a.ts", project_path: "/repo" }),
      event("cursor", "checkpoint", 5),
      event("cursor", "session_ended", 9, { duration_ms: provider(8_500) })
    ])!;
    expect(summary.turns).toEqual({ count: 1, basis: "cursor_stop" });
    expect(summary.tools).toEqual([{ name: "Shell", count: 1, failed: 0 }]);
    expect(summary.files).toEqual([{ path: "a.ts", events: 1, changed: true, tools: [] }]);
    expect(summary.reportedDuration).toEqual({ value: 8_500, origin: "provider" });
  });

  it("sums only the token fields actually reported, keeping their origin", () => {
    const summary = summarizeSession([
      event("codex", "model_usage", 0, { model: provider("gpt-5-codex"), input_tokens: provider(1_000), output_tokens: provider(100) }),
      event("codex", "model_usage", 5, { model: provider("gpt-5-codex"), input_tokens: provider(2_000) }),
      event("codex", "tool_finished", 6, { tool_name: "shell" })
    ])!;
    expect(summary.tokens).toEqual({ input: 3_000, output: 100, cacheRead: null, cacheWrite: null, origins: ["provider"], usageEvents: 2 });
    expect(summary.models).toEqual([{ name: "gpt-5-codex", origins: ["provider"], events: 2 }]);
    // gpt-5-codex has no verified price in the table: no cost at all.
    expect(summary.cost).toBeNull();
  });

  it("leaves output tokens absent when no event reports them", () => {
    const summary = summarizeSession([event("claude_code", "tool_finished", 0, { input_tokens: provider(10) })])!;
    expect(summary.tokens?.output).toBeNull();
    expect(summary.tokens?.input).toBe(10);
  });
});

describe("estimated cost", () => {
  it("prices Claude cache reads and writes at the published cache rates", () => {
    const cost = estimateCost([
      event("claude_code", "model_usage", 0, { model: provider("claude-opus-5-5"), input_tokens: provider(1_000_000), output_tokens: provider(0), cache_read_tokens: provider(10_000_000), cache_write_tokens: provider(1_000_000) })
    ])!;
    // Opus 5.5: 4 $ input → 0.4 $ cache read and 5 $ cache write per million.
    expect(cost.value).toBeCloseTo(4 + 10 * 0.4 + 5, 10);
    expect(cost.unpricedEvents).toBe(0);
  });

  it("prices each event with its own model and flags the estimate", () => {
    const cost = estimateCost([
      event("claude_code", "tool_finished", 0, { model: provider("claude-sonnet-4-6"), input_tokens: provider(1_000_000), output_tokens: provider(100_000) }),
      event("claude_code", "tool_finished", 1, { model: provider("claude-opus-5-5"), input_tokens: provider(500_000), output_tokens: provider(0) })
    ])!;
    expect(cost.origin).toBe("estimated");
    expect(cost.currency).toBe("USD");
    expect(cost.value).toBeCloseTo(3 + 1.5 + 2, 10);
    expect(cost.pricedEvents).toBe(2);
    expect(cost.unpricedEvents).toBe(0);
    expect(cost.prices.map((price) => price.checkedOn)).toEqual(["2026-10-06", "2026-10-06"]);
  });

  it("reports unknown models, missing models and incomplete counts as unpriced", () => {
    const cost = estimateCost([
      event("claude_code", "tool_finished", 0, { model: provider("claude-haiku-4-5-20251001"), input_tokens: provider(1_000_000), output_tokens: provider(0) }),
      event("codex", "model_usage", 1, { model: provider("some-unknown-model"), input_tokens: provider(10), output_tokens: provider(5) }),
      event("claude_code", "tool_finished", 2, { input_tokens: provider(7), output_tokens: provider(3) }),
      event("claude_code", "tool_finished", 3, { model: provider("claude-haiku-4-5"), input_tokens: provider(4) })
    ])!;
    expect(cost.value).toBeCloseTo(1, 10);
    expect(cost.pricedEvents).toBe(1);
    expect(cost.unpricedEvents).toBe(3);
    expect(cost.unpricedInputTokens).toBe(21);
    expect(cost.unpricedOutputTokens).toBe(8);
    expect(cost.unpricedModels).toEqual(["claude-haiku-4-5", "modèle non fourni", "some-unknown-model"]);
  });

  it("does not price requests above a model's base-rate threshold", () => {
    expect(estimateCost([
      event("claude_code", "tool_finished", 0, { model: provider("claude-haiku-5-5"), input_tokens: provider(150_000), output_tokens: provider(10) })
    ])).toBeNull();
  });

  it("returns null when nothing can be priced", () => {
    expect(estimateCost([event("codex", "model_usage", 0, { model: provider("unknown"), input_tokens: provider(1), output_tokens: provider(1) })])).toBeNull();
    expect(estimateCost([event("codex", "tool_finished", 0)])).toBeNull();
  });
});

describe("price table lookup", () => {
  it("normalizes provider prefixes and snapshot dates but never fuzzy-matches", () => {
    expect(normalizeModelId("anthropic/Claude-Sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(findModelPrice("claude-opus-5-5")?.inputPerMTok).toBe(4);
    expect(findModelPrice("claude-opus-5-5-preview")).toBeNull();
    expect(findModelPrice("claude-opus")).toBeNull();
  });
});

describe("helpers", () => {
  it("flags sessions that may extend past the loaded history page", () => {
    const old = event("codex", "checkpoint", 0, { session_id: "a" });
    const recent = event("codex", "checkpoint", 50, { session_id: "b" });
    expect(isPossiblyTruncated([old], [recent, old], true)).toBe(true);
    expect(isPossiblyTruncated([recent], [recent, old], true)).toBe(false);
    expect(isPossiblyTruncated([old], [recent, old], false)).toBe(false);
  });

  it("matches a session to the selected repository by path or Gemini hash", () => {
    expect(sessionMatchesRepository([event("claude_code", "user_message", 0, { project_path: "C:\\Work\\Repo\\" })], "c:/work/repo", "h")).toBe(true);
    expect(sessionMatchesRepository([event("gemini_cli", "user_message", 0, { project_hash: "h" })], "/elsewhere", "h")).toBe(true);
    expect(sessionMatchesRepository([event("codex", "user_message", 0, { project_path: "/other" })], "/repo", "h")).toBe(false);
  });
});
