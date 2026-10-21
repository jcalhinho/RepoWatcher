import { describe, expect, it } from "vitest";
import { bucketSeries, modelsUsed, timeAxis, toolCallsByAgent, tokensByAgent, topFiles, topTools, turnDurations } from "./analytics";
import type { SessionEvent } from "./types";

const now = Date.parse("2026-10-21T12:00:00.000Z");
let counter = 0;

function event(provider: string, kind: string, minutesAgo: number, extra: Partial<SessionEvent> = {}): SessionEvent {
  counter += 1;
  return {
    event_id: `e${counter}`,
    session_id: "s1",
    occurred_at: new Date(now - minutesAgo * 60_000).toISOString(),
    provider,
    kind,
    project_path: null,
    tool_name: null,
    file_path: null,
    ...extra
  };
}

describe("session analytics", () => {
  it("buckets events per provider on the selected window and ignores older ones", () => {
    const axis = timeAxis([], "1h", now);
    const series = bucketSeries([
      event("codex", "tool_started", 1),
      event("codex", "tool_finished", 1),
      event("qwen_code", "user_message", 59),
      event("codex", "tool_started", 90)
    ], ["codex", "qwen_code"], axis);
    expect(axis.buckets).toBe(30);
    expect(series[0].values.at(-1)).toBe(2);
    expect(series[0].values.reduce((a, b) => a + b, 0)).toBe(2);
    expect(series[1].values[0]).toBe(1);
  });

  it("spans every loaded event on the 'all' window", () => {
    const axis = timeAxis([event("codex", "checkpoint", 3 * 24 * 60)], "all", now);
    expect(axis.start).toBe(now - 3 * 24 * 60 * 60_000);
  });

  it("counts tool outcomes, tools and files without double counting start/finish pairs", () => {
    const events = [
      event("codex", "tool_started", 1, { tool_name: "edit", file_path: "src/a.ts" }),
      event("codex", "tool_finished", 1, { tool_name: "edit", file_path: "src/a.ts" }),
      event("codex", "tool_started", 1, { tool_name: "read_file", file_path: "src/a.ts" }),
      event("codex", "tool_failed", 1, { tool_name: "read_file", file_path: "src/a.ts" }),
      event("cursor", "file_changed", 1, { file_path: "src/b.ts" })
    ];
    expect(toolCallsByAgent(events, ["codex", "cursor"])).toEqual([{ key: "codex", succeeded: 1, failed: 1 }]);
    expect(topTools(events)).toEqual([{ name: "edit", calls: 1, failed: 0 }, { name: "read_file", calls: 1, failed: 1 }]);
    expect(topFiles(events)).toEqual([{ path: "src/a.ts", reads: 1, writes: 1 }, { path: "src/b.ts", reads: 0, writes: 1 }]);
  });

  it("sums provider-reported tokens and durations only", () => {
    const events = [
      event("qwen_code", "model_usage", 1, { model: { value: "qwen3-coder", origin: "provider" }, input_tokens: { value: 1000, origin: "provider" }, output_tokens: { value: 50, origin: "provider" } }),
      event("qwen_code", "checkpoint", 1, { duration_ms: { value: 4000, origin: "provider" } }),
      event("qwen_code", "checkpoint", 1, { duration_ms: { value: 2000, origin: "provider" } }),
      event("qwen_code", "checkpoint", 1)
    ];
    expect(tokensByAgent(events, ["qwen_code", "codex"])).toEqual([{ key: "qwen_code", input: 1000, output: 50 }]);
    expect(turnDurations(events, ["qwen_code"])).toEqual([{ key: "qwen_code", turns: 2, averageMs: 3000, longestMs: 4000 }]);
    expect(modelsUsed(events)).toEqual([{ model: "qwen3-coder", requests: 1, tokens: 1050 }]);
  });
});
