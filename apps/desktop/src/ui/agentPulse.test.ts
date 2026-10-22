import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { agentPulse, sortPulses } from "./agentPulse";
import type { SessionEvent } from "./types";

const now = Date.parse("2026-10-21T12:00:00.000Z");
let counter = 0;

function event(kind: string, secondsAgo: number, extra: Partial<SessionEvent> = {}): SessionEvent {
  counter += 1;
  return { event_id: `e${counter}`, session_id: "s1", occurred_at: new Date(now - secondsAgo * 1000).toISOString(), provider: "qwen_code", kind, project_path: "/work/demo", tool_name: null, file_path: null, ...extra };
}

beforeAll(() => setLang("fr"));

describe("agent pulse for the mini view", () => {
  it("is working while a turn is open and events keep coming", () => {
    const pulse = agentPulse("qwen_code", [
      event("user_message", 60),
      event("tool_started", 10, { tool_name: "edit", file_path: "/work/demo/src/a.ts" }),
      event("tool_finished", 5, { tool_name: "edit", file_path: "/work/demo/src/a.ts" })
    ], now);
    expect(pulse.status).toBe("working");
    expect(pulse.turnStartedAt).toBe(now - 60_000);
    expect(pulse.current?.text).toBe("✓ A modifié demo/src/a.ts");
    expect(pulse.session?.filesChanged).toBe(1);
    expect(pulse.spark.at(-1)).toBe(2);
  });

  it("is stalled when a turn is open but silent for minutes, and waiting once the turn ended", () => {
    const stalled = agentPulse("qwen_code", [event("user_message", 400), event("tool_started", 300, { tool_name: "run_shell_command" })], now);
    expect(stalled.status).toBe("stalled");
    const waiting = agentPulse("qwen_code", [event("user_message", 400), event("checkpoint", 200, { outcome: "turn-completed" })], now);
    expect(waiting.status).toBe("waiting");
    expect(waiting.turnStartedAt).toBeNull();
  });

  it("flags consecutive tool failures as blocked", () => {
    const pulse = agentPulse("qwen_code", [
      event("user_message", 90),
      event("tool_finished", 60, { tool_name: "edit" }),
      event("tool_failed", 30, { tool_name: "edit" }),
      event("tool_failed", 20, { tool_name: "edit" })
    ], now);
    expect(pulse.failureStreak).toBe(2);
    expect(pulse.status).toBe("blocked");
  });

  it("treats a Codex turn-start checkpoint as an open turn, not a finished one", () => {
    const pulse = agentPulse("codex", [event("checkpoint", 20, { provider: "codex", outcome: "turn-started:t1" })], now);
    expect(pulse.status).toBe("working");
  });

  it("reports a looping agent with its evidence, ahead of everything else", () => {
    const repeated = Array.from({ length: 6 }, (_, index) => event("tool_finished", 60 - index * 5, { tool_name: "read_file", file_path: "/work/demo/same.rs" }));
    const pulse = agentPulse("qwen_code", [event("user_message", 90), ...repeated], now);
    expect(pulse.status).toBe("looping");
    expect(pulse.loop?.evidence).toContain("répété 6 fois");
    expect(sortPulses([agentPulse("codex", [event("tool_failed", 5, { provider: "codex" }), event("tool_failed", 4, { provider: "codex" })], now), pulse])[0].status).toBe("looping");
  });

  it("orders agents by how much they need attention", () => {
    const never = agentPulse("cursor", [], now);
    const working = agentPulse("qwen_code", [event("user_message", 5)], now);
    const blocked = agentPulse("codex", [event("tool_failed", 5, { provider: "codex" }), event("tool_failed", 4, { provider: "codex" })], now);
    expect(sortPulses([never, working, blocked]).map((pulse) => pulse.status)).toEqual(["blocked", "working", "never"]);
  });
});
