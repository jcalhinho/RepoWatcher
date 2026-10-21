export type RaceStatus = "ready" | "running" | "recent" | "finished" | "idle";
export type RaceEvent = {
  event_id: string;
  session_id: string;
  occurred_at: string;
  provider: string;
  kind: string;
  outcome?: string | null;
};
export type RaceState = { status: RaceStatus; latest: RaceEvent | null; progress: number; activityCount: number; startedAt: number | null };

export function deriveRaceState(provider: string, events: RaceEvent[], now: number): RaceState {
  const sessions = new Map<string, RaceEvent[]>();
  for (const event of events) {
    if (event.provider !== provider) continue;
    sessions.set(event.session_id, [...(sessions.get(event.session_id) || []), event]);
  }
  const candidates: RaceState[] = [];
  for (const sessionEvents of sessions.values()) {
    const ordered = [...sessionEvents].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    let status: RaceStatus = "idle";
    let startedAt: number | null = null;
    let activityCount = 0;
    let latest = ordered[0];
    for (const event of ordered) {
      latest = event;
      const timestamp = new Date(event.occurred_at).getTime();
      if (event.kind === "session_ended" || (event.kind === "checkpoint" && isTurnComplete(provider, event))) {
        status = "finished";
        startedAt = null;
        activityCount = 0;
        continue;
      }
      if (event.kind === "session_started" && !isTurnStart(provider, event)) {
        status = "idle";
        startedAt = null;
        activityCount = 0;
        continue;
      }
      const boundedSignal = provider === "opencode" || provider === "gemini_cli" || provider === "cursor";
      if (!boundedSignal && isTurnStart(provider, event)) {
        if (status !== "running" || event.kind === "user_message" || event.outcome?.startsWith("turn-started:")) startedAt = timestamp;
        status = "running";
        activityCount += 1;
      } else if (status === "running" && timestamp >= (startedAt || 0)) {
        activityCount += 1;
      }
      if (boundedSignal && !isTurnComplete(provider, event) && timestamp >= now - 45_000 && event.kind !== "session_started" && event.kind !== "session_ended") {
        status = "recent";
        startedAt ??= timestamp;
        activityCount = Math.max(1, activityCount + 1);
      }
    }
    const lastAt = new Date(latest.occurred_at).getTime();
    if (status === "recent" && lastAt < now - 45_000) status = "idle";
    const elapsedSeconds = startedAt === null ? 0 : Math.max(0, (now - startedAt) / 1000);
    const progress = status === "finished" ? 100 : status === "running" || status === "recent"
      ? Math.min(92, Math.round(7 + (activityCount - 1) * 5 + elapsedSeconds * 0.55))
      : 0;
    candidates.push({ status, latest, progress, activityCount, startedAt });
  }
  const active = candidates.filter((candidate) => candidate.status === "running" || candidate.status === "recent").sort((a, b) => (b.latest?.occurred_at || "").localeCompare(a.latest?.occurred_at || ""))[0];
  if (active) return active;
  const latest = candidates.sort((a, b) => (b.latest?.occurred_at || "").localeCompare(a.latest?.occurred_at || ""))[0];
  return latest || { status: "ready", latest: null, progress: 0, activityCount: 0, startedAt: null };
}

export function isTurnStart(provider: string, event: RaceEvent) {
  if (event.kind === "user_message" || event.kind === "tool_started") return true;
  return provider === "codex" && event.outcome?.startsWith("turn-started:") === true;
}

export function isTurnComplete(provider: string, event: RaceEvent) {
  // Claude asking for a permission is a pause, not the end of the turn.
  if ((event.outcome ?? "").startsWith("attention:")) return false;
  if (provider === "codex") return event.kind === "checkpoint" && event.outcome?.startsWith("turn-complete:") === true;
  return event.kind === "checkpoint";
}
