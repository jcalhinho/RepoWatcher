import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AnalyticsRange } from "./analytics";
import { isActiveProvider, normalizeEvent } from "./providers";
import type { SessionEvent } from "./types";

const RANGE_MS: Record<Exclude<AnalyticsRange, "all">, number> = { "15m": 15 * 60_000, "1h": 60 * 60_000, "24h": 24 * 60 * 60_000 };
const REFRESH_MS = 30_000;

type AnalyticsResponse = { events: SessionEvent[]; total: number; truncated: boolean };

export type AnalyticsDataset = {
  events: SessionEvent[];
  /** Stored events in the window; more than `events.length` when the window was capped. */
  total: number;
  truncated: boolean;
  /** "database": every stored event of the window; "loaded": only what the dashboard loaded (web preview). */
  source: "database" | "loaded";
};

/**
 * Every stored event of the analytics window, read from the local database (not only the 500
 * events the dashboard keeps in memory), refreshed every 30 s and merged with live events.
 */
export function useAnalyticsEvents(range: AnalyticsRange, liveEvents: SessionEvent[]): AnalyticsDataset {
  const [stored, setStored] = useState<AnalyticsResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const since = range === "all" ? null : new Date(Date.now() - RANGE_MS[range]).toISOString();
    invoke<AnalyticsResponse>("load_analytics_events", { since })
      .then((response) => { if (active) setStored({ ...response, events: response.events.map(normalizeEvent).filter((event) => isActiveProvider(event.provider)) }); })
      .catch(() => { if (active) setStored(null); });
    return () => { active = false; };
  }, [range, tick]);

  return useMemo(() => {
    if (!stored) return { events: liveEvents, total: liveEvents.length, truncated: false, source: "loaded" };
    // Live events received since the last database read are added on top.
    const known = new Set(stored.events.map((event) => event.event_id));
    const newest = stored.events.length ? Date.parse(stored.events[0].occurred_at) : 0;
    const fresh = liveEvents.filter((event) => !known.has(event.event_id) && Date.parse(event.occurred_at) >= newest);
    return { events: fresh.length ? [...fresh, ...stored.events] : stored.events, total: stored.total + fresh.length, truncated: stored.truncated, source: "database" };
  }, [stored, liveEvents]);
}
