import { describe, expect, it } from "vitest";
import { deriveRaceState, type RaceEvent } from "./race";

const baseTime = Date.parse("2026-10-20T12:00:00.000Z");

function event(provider: string, kind: string, seconds: number, outcome?: string): RaceEvent {
  return {
    event_id: `${provider}-${kind}-${seconds}`,
    session_id: "session-1",
    occurred_at: new Date(baseTime + seconds * 1000).toISOString(),
    provider,
    kind,
    outcome
  };
}

describe("provider race state", () => {
  it("keeps a Claude turn running through tool events until its stop checkpoint", () => {
    const events = [
      event("claude_code", "user_message", 0),
      event("claude_code", "tool_started", 3),
      event("claude_code", "tool_finished", 6)
    ];
    const running = deriveRaceState("claude_code", events, baseTime + 7_000);
    expect(running.status).toBe("running");
    expect(running.activityCount).toBe(3);
    expect(running.progress).toBeGreaterThan(0);

    const finished = deriveRaceState("claude_code", [...events, event("claude_code", "checkpoint", 8)], baseTime + 9_000);
    expect(finished.status).toBe("finished");
    expect(finished.progress).toBe(100);
  });

  it("uses Codex turn markers even when the first task-start event is session_started", () => {
    const started = event("codex", "session_started", 0, "turn-started:t1");
    expect(deriveRaceState("codex", [started], baseTime + 1_000).status).toBe("running");

    const completed = event("codex", "checkpoint", 4, "turn-complete:t1");
    expect(deriveRaceState("codex", [started, completed], baseTime + 5_000).status).toBe("finished");
  });

  it("labels OpenCode activity as recent, then returns it to idle when the signal ages out", () => {
    const message = event("opencode", "user_message", 0);
    expect(deriveRaceState("opencode", [message], baseTime + 10_000).status).toBe("recent");
    expect(deriveRaceState("opencode", [message], baseTime + 46_000).status).toBe("idle");
  });

  it("does not show activity for another provider's events", () => {
    expect(deriveRaceState("gemini_cli", [event("codex", "user_message", 0)], baseTime + 1_000).status).toBe("ready");
  });

  it("matches Gemini CLI's stored provider key and expires recent activity", () => {
    const message = event("gemini_cli", "user_message", 0);
    expect(deriveRaceState("gemini_cli", [message], baseTime + 10_000).status).toBe("recent");
    expect(deriveRaceState("gemini_cli", [message], baseTime + 46_000).status).toBe("idle");
  });
});
