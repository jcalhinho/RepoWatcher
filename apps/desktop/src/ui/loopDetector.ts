import { t } from "./i18n";
import type { SessionEvent } from "./types";

/** Evidence that an agent repeats itself without making progress. */
export type LoopFinding = { reason: "repeat" | "cycle" | "edit-fail"; evidence: string };

const WINDOW_CALLS = 24;
const WRITE_TOOL = /edit|write|patch|replace|create/i;

type Call = { signature: string; label: string; failed: boolean; writes: string | null };

function shortTarget(event: SessionEvent) {
  if (event.file_path) return event.file_path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");
  if (event.command) return event.command.trim().split(/\s+/).slice(0, 2).join(" ");
  return "";
}

/**
 * Tool calls of the open turn, oldest first. A call is its start event; connectors that only report
 * ends (or failures) count those instead. Failures are attached to the call they end.
 */
function recentCalls(events: SessionEvent[]): Call[] {
  const ordered = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  // Only the turn in progress: a finished turn or a new prompt resets the history.
  let start = 0;
  ordered.forEach((event, index) => {
    if (event.kind === "user_message" || event.kind === "session_ended" || (event.kind === "checkpoint" && !/^(turn-started|attention:)/.test(event.outcome ?? ""))) start = index + 1;
  });
  const calls: Call[] = [];
  const hasStarts = ordered.slice(start).some((event) => event.kind === "tool_started");
  for (const event of ordered.slice(start)) {
    const isCall = hasStarts ? event.kind === "tool_started" : event.kind === "tool_finished" || event.kind === "tool_failed";
    if (isCall) {
      const target = shortTarget(event);
      const tool = event.tool_name ?? t("outil", "tool");
      calls.push({ signature: `${tool.toLowerCase()}|${target}`, label: target ? `${tool} ${target}` : tool, failed: event.kind === "tool_failed", writes: WRITE_TOOL.test(tool) ? target || null : null });
    } else if (event.kind === "tool_failed" && calls.length) {
      calls[calls.length - 1].failed = true;
    }
  }
  return calls.slice(-WINDOW_CALLS);
}

/**
 * Detects an agent going round in circles in its current turn:
 * - the same action on the same target over and over;
 * - a short sequence of actions repeating itself (e.g. edit → test → fail, three times);
 * - the same file modified again and again while actions keep failing.
 */
export function detectLoop(events: SessionEvent[]): LoopFinding | null {
  const calls = recentCalls(events);
  if (calls.length < 6) return null;

  const counts = new Map<string, { count: number; failed: number; label: string }>();
  for (const call of calls.slice(-12)) {
    const entry = counts.get(call.signature) ?? { count: 0, failed: 0, label: call.label };
    entry.count += 1;
    if (call.failed) entry.failed += 1;
    counts.set(call.signature, entry);
  }
  for (const entry of counts.values()) {
    if (entry.count >= 6 || (entry.count >= 4 && entry.failed >= 2)) {
      return { reason: "repeat", evidence: t(`« ${entry.label} » répété ${entry.count} fois${entry.failed ? `, dont ${entry.failed} en échec` : ""}`, `“${entry.label}” repeated ${entry.count} times${entry.failed ? `, ${entry.failed} failed` : ""}`) };
    }
  }

  const signatures = calls.map((call) => call.signature);
  for (let period = 2; period <= 4; period += 1) {
    const span = period * 3;
    if (signatures.length < span) continue;
    const tail = signatures.slice(-span);
    const distinct = new Set(tail.slice(0, period)).size;
    if (distinct > 1 && tail.every((signature, index) => index < period || signature === tail[index - period])) {
      const cycle = calls.slice(-period).map((call) => call.label).join(" → ");
      return { reason: "cycle", evidence: t(`même enchaînement 3 fois de suite : ${cycle}`, `same sequence 3 times in a row: ${cycle}`) };
    }
  }

  const edits = new Map<string, number>();
  for (const call of calls) if (call.writes) edits.set(call.writes, (edits.get(call.writes) ?? 0) + 1);
  const failures = calls.filter((call) => call.failed).length;
  for (const [file, count] of edits) {
    if (count >= 5 && failures >= 2) return { reason: "edit-fail", evidence: t(`${file} modifié ${count} fois alors que ${failures} actions échouent`, `${file} edited ${count} times while ${failures} actions fail`) };
  }
  return null;
}
