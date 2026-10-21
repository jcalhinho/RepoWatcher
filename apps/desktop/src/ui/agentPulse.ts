import { narrateEvent, type Narration } from "./activity-copy";
import { WRITE_TOOL } from "./analytics";
import { detectLoop, type LoopFinding } from "./loopDetector";
import { summarizeSession } from "./sessionSummary";
import type { SessionEvent } from "./types";

/**
 * At-a-glance state of one agent, ordered by how much it needs the user:
 * looping (repeats itself without progress) → blocked (repeated failures) → stalled (turn open but silent) → waiting (turn finished, waiting
 * for the next prompt) → working → idle → never seen.
 */
export type PulseStatus = "looping" | "blocked" | "stalled" | "waiting" | "working" | "idle" | "never";

const PULSE_ORDER: PulseStatus[] = ["looping", "blocked", "stalled", "waiting", "working", "idle", "never"];

export type PulseAction = Narration & { id: string; at: number };

export type AgentPulse = {
  key: string;
  status: PulseStatus;
  lastEventAt: number | null;
  /** Narration of the latest describable event. */
  current: PulseAction | null;
  recent: PulseAction[];
  /** Start of the turn in progress, when one is open. */
  turnStartedAt: number | null;
  failureStreak: number;
  /** Set when the open turn repeats itself without progress. */
  loop: LoopFinding | null;
  session: {
    id: string;
    turns: number;
    toolCalls: number;
    failures: number;
    inputTokens: number | null;
    outputTokens: number | null;
    filesChanged: number;
    /** Estimated USD cost, only when every priced model is known; null otherwise. */
    cost: number | null;
    model: string | null;
  } | null;
  /** Where the latest event happened, to name its repository. */
  project: { project_path: string | null; file_path: string | null; project_hash: string | null } | null;
  /** Events per minute over the last 15 minutes, oldest first. */
  spark: number[];
};

const WORKING_WINDOW_MS = 45_000;
const STALLED_AFTER_MS = 2 * 60_000;
const WAITING_WINDOW_MS = 30 * 60_000;
const BLOCKED_WINDOW_MS = 10 * 60_000;
const SPARK_MINUTES = 15;

function isTurnEnd(event: SessionEvent) {
  if (event.kind === "session_ended") return true;
  if (event.kind !== "checkpoint") return false;
  // Codex also emits checkpoints when a turn starts.
  return !(event.outcome ?? "").startsWith("turn-started");
}

function isTurnStart(event: SessionEvent) {
  return event.kind === "user_message" || (event.kind === "checkpoint" && (event.outcome ?? "").startsWith("turn-started"));
}

export function agentPulse(key: string, events: SessionEvent[], now: number): AgentPulse {
  const own = events.filter((event) => event.provider === key).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const spark = Array.from({ length: SPARK_MINUTES }, () => 0);
  for (const event of own) {
    const age = now - Date.parse(event.occurred_at);
    if (age >= 0 && age < SPARK_MINUTES * 60_000) spark[SPARK_MINUTES - 1 - Math.floor(age / 60_000)] += 1;
  }
  if (!own.length) return { key, status: "never", lastEventAt: null, current: null, recent: [], turnStartedAt: null, failureStreak: 0, loop: null, session: null, project: null, spark };

  const latest = own[0];
  const lastEventAt = Date.parse(latest.occurred_at);
  const recent: PulseAction[] = [];
  for (const event of own) {
    const narration = narrateEvent(event);
    if (narration) recent.push({ ...narration, id: event.event_id, at: Date.parse(event.occurred_at) });
    if (recent.length >= 4) break;
  }

  // Consecutive failed tool results, newest first.
  let failureStreak = 0;
  for (const event of own) {
    if (event.kind === "tool_failed") failureStreak += 1;
    else if (event.kind === "tool_finished" || isTurnEnd(event)) break;
  }

  let turnStartedAt: number | null = null;
  for (const event of own) {
    if (isTurnEnd(event)) break;
    if (isTurnStart(event)) {
      turnStartedAt = Date.parse(event.occurred_at);
      break;
    }
  }
  const age = now - lastEventAt;
  const turnOpen = !isTurnEnd(latest);

  const sessionEvents = own.filter((event) => event.session_id === latest.session_id);
  const loop = turnOpen && age < BLOCKED_WINDOW_MS ? detectLoop(sessionEvents) : null;

  let status: PulseStatus;
  if (loop) status = "looping";
  else if (failureStreak >= 2 && age < BLOCKED_WINDOW_MS) status = "blocked";
  else if (turnOpen && age < WORKING_WINDOW_MS) status = "working";
  else if (turnOpen && turnStartedAt !== null && age < WAITING_WINDOW_MS && age >= STALLED_AFTER_MS) status = "stalled";
  else if (turnOpen && turnStartedAt !== null && age < STALLED_AFTER_MS) status = "working";
  else if (!turnOpen && age < WAITING_WINDOW_MS && latest.kind !== "session_ended") status = "waiting";
  else status = "idle";

  const summary = summarizeSession(sessionEvents);
  return {
    key,
    status,
    lastEventAt,
    current: recent[0] ?? null,
    recent,
    turnStartedAt: turnOpen ? turnStartedAt : null,
    failureStreak,
    loop,
    session: summary && {
      id: summary.sessionId,
      turns: summary.turns.count,
      toolCalls: summary.tools.reduce((sum, tool) => sum + tool.count, 0),
      failures: summary.failures.count,
      inputTokens: summary.tokens && (summary.tokens.input !== null || summary.tokens.cacheRead !== null || summary.tokens.cacheWrite !== null) ? (summary.tokens.input ?? 0) + (summary.tokens.cacheRead ?? 0) + (summary.tokens.cacheWrite ?? 0) : null,
      outputTokens: summary.tokens?.output ?? null,
      filesChanged: new Set(sessionEvents.filter((event) => event.file_path && (event.kind === "file_changed" || (event.kind === "tool_started" && WRITE_TOOL.test(event.tool_name || "")))).map((event) => event.file_path)).size,
      cost: summary.cost && summary.cost.unpricedEvents === 0 ? summary.cost.value : null,
      model: summary.models[0]?.name ?? null
    },
    project: { project_path: latest.project_path, file_path: latest.file_path, project_hash: latest.project_hash ?? null },
    spark
  };
}

export function sortPulses(pulses: AgentPulse[]) {
  return [...pulses].sort((a, b) => PULSE_ORDER.indexOf(a.status) - PULSE_ORDER.indexOf(b.status) || (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0));
}
