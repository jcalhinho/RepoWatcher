import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import type { AgentPulse } from "./agentPulse";
import { notices } from "./notificationRules";

const now = Date.parse("2026-10-21T12:00:00Z");
const names = new Map([["codex", "Codex"]]);

function pulse(status: AgentPulse["status"], extra: Partial<AgentPulse> = {}): AgentPulse {
  return {
    key: "codex", status, lastEventAt: now - 5_000, current: { id: "e1", at: now - 5_000, text: "Tour terminé", detail: null, tone: "success" }, recent: [],
    turnStartedAt: null, failureStreak: 0, loop: null, session: { id: "s1", turns: 1, toolCalls: 3, failures: 0, inputTokens: null, outputTokens: null, filesChanged: 0, cost: null, model: null },
    project: { project_path: "/w", file_path: null, project_hash: null }, spark: [], ...extra
  };
}

beforeAll(() => setLang("fr"));

describe("notification rules", () => {
  it("notifies once when an agent starts waiting, and again after a new turn", () => {
    const first = notices([pulse("waiting")], new Map(), names, now);
    expect(first.send.map((notice) => notice.title)).toEqual(["Codex t’attend"]);
    expect(notices([pulse("waiting")], first.next, names, now).send).toEqual([]);
    const working = notices([pulse("working")], first.next, names, now);
    expect(working.send).toEqual([]);
    expect(notices([pulse("waiting")], working.next, names, now).send).toHaveLength(1);
  });

  it("raises loops and repeated failures as alerts, without repeating while they last", () => {
    const looping = pulse("looping", { loop: { reason: "repeat", evidence: "« Bash » répété 6 fois" } });
    const first = notices([looping], new Map(), names, now);
    expect(first.send[0]).toMatchObject({ kind: "loop", alert: true, title: "⚠ Codex tourne en rond", body: "« Bash » répété 6 fois" });
    const later = { ...looping, current: { id: "e9", at: now, text: "Lance « cargo … »", detail: null, tone: "work" as const }, lastEventAt: now };
    expect(notices([later], first.next, names, now).send).toEqual([]);
    expect(notices([pulse("blocked", { failureStreak: 3 })], first.next, names, now).send[0]).toMatchObject({ kind: "error", alert: true });
  });

  it("ignores agents idle for long and those without a session", () => {
    expect(notices([pulse("waiting", { lastEventAt: now - 3_600_000 })], new Map(), names, now).send).toEqual([]);
    expect(notices([pulse("waiting", { session: null })], new Map(), names, now).send).toEqual([]);
  });

  it("tells a permission request apart from a finished turn", () => {
    const asking = pulse("waiting", { current: { id: "e2", at: now, text: "Attend ta validation", detail: "Claude needs your permission to use Bash", tone: "info", marker: "needs-approval" } });
    expect(notices([asking], new Map(), names, now).send[0]).toMatchObject({ kind: "permission", title: "Codex attend ta validation" });
  });
});
