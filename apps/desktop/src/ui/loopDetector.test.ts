import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { detectLoop } from "./loopDetector";
import type { SessionEvent } from "./types";

let clock = Date.parse("2026-10-21T12:00:00Z");
function event(kind: string, extra: Partial<SessionEvent> = {}): SessionEvent {
  clock += 1000;
  return { event_id: `e${clock}`, session_id: "s", occurred_at: new Date(clock).toISOString(), provider: "codex", kind, project_path: "/w", tool_name: null, file_path: null, ...extra };
}
const call = (tool: string, file?: string, failed = false) => [event("tool_started", { tool_name: tool, file_path: file ?? null }), event(failed ? "tool_failed" : "tool_finished", { tool_name: tool, file_path: file ?? null })];

beforeAll(() => setLang("fr"));

describe("loop detection", () => {
  it("ignores normal varied work", () => {
    const events = [event("user_message"), ...call("Read", "/w/a.ts"), ...call("Grep"), ...call("Edit", "/w/a.ts"), ...call("Bash"), ...call("Read", "/w/b.ts"), ...call("Edit", "/w/b.ts"), ...call("Bash")];
    expect(detectLoop(events)).toBeNull();
  });

  it("flags the same failing action repeated", () => {
    const events = [event("user_message"), ...call("Read", "/w/x.ts"), ...call("Bash", undefined, true), ...call("Bash", undefined, true), ...call("Bash", undefined, true), ...call("Bash", undefined, true), ...call("Read", "/w/y.ts")];
    expect(detectLoop(events)).toMatchObject({ reason: "repeat" });
  });

  it("flags a repeating cycle such as edit → test → fail", () => {
    const cycle = () => [...call("Edit", "/w/src/a.ts"), ...call("Bash", undefined, true)];
    const events = [event("user_message"), ...call("Read", "/w/src/a.ts"), ...cycle(), ...cycle(), ...cycle()];
    const finding = detectLoop(events);
    expect(finding?.reason).toBe("cycle");
    expect(finding?.evidence).toContain("Edit src/a.ts → Bash");
  });

  it("only looks at the turn in progress", () => {
    const old = Array.from({ length: 4 }, () => call("Bash", undefined, true)).flat();
    const events = [event("user_message"), ...old, event("checkpoint", { outcome: "turn-completed" }), event("user_message"), ...call("Read", "/w/a.ts"), ...call("Edit", "/w/a.ts")];
    expect(detectLoop(events)).toBeNull();
  });

  it("works with connectors that only report ends of actions", () => {
    const events = [event("user_message"), ...Array.from({ length: 6 }, () => event("tool_finished", { tool_name: "read_file", file_path: "/w/same.rs" }))];
    expect(detectLoop(events)?.evidence).toContain("répété 6 fois");
  });
});
