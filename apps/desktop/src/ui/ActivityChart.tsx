import { useMemo } from "react";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

const BUCKETS = 30;
const BUCKET_MS = 2 * 60 * 1000;

export function ActivityChart({ events }: { events: SessionEvent[] }) {
  // Two-minute buckets do not need a per-second clock; new events re-render with a fresh timestamp anyway.
  const tick = useNow(10_000);
  const { activity, input, output } = useMemo(() => bucketEvents(events, Math.max(tick, Date.now())), [events, tick]);
  const points = (values: number[], scale = Math.max(1, ...values)) => {
    const max = scale;
    return values.map((value, index) => `${index * 20},${74 - value / max * 58}`).join(" ");
  };
  const tokenScale = Math.max(1, ...input, ...output);
  return <div className="activity-chart" aria-label="Événements et tokens par tranche de deux minutes, dernière heure"><div className="chart-caption"><span>Événements / 2 min</span><span>60 dernières minutes</span></div><svg viewBox="0 0 580 88" preserveAspectRatio="none" role="img" aria-label="Événements observés"><line x1="0" y1="74" x2="580" y2="74" /><line x1="0" y1="45" x2="580" y2="45" /><line x1="0" y1="16" x2="580" y2="16" /><polyline className="event-line" points={points(activity)} /></svg>{(input.some(Boolean) || output.some(Boolean)) && <><div className="chart-caption token-chart-caption"><span>Tokens provider / 2 min</span><span>maximum par tranche sur 60 min</span></div><svg viewBox="0 0 580 88" preserveAspectRatio="none" role="img" aria-label="Input et output tokens observés, échelle commune"><line x1="0" y1="74" x2="580" y2="74" /><line x1="0" y1="45" x2="580" y2="45" /><line x1="0" y1="16" x2="580" y2="16" /><polyline className="input-line" points={points(input, tokenScale)} /><polyline className="output-line" points={points(output, tokenScale)} /></svg><div className="chart-legend"><span className="input-legend">Input</span><span className="output-legend">Output</span></div></>}</div>;
}

function bucketEvents(events: SessionEvent[], now: number) {
  const activity = Array.from({ length: BUCKETS }, () => 0);
  const input = Array.from({ length: BUCKETS }, () => 0);
  const output = Array.from({ length: BUCKETS }, () => 0);
  for (const event of events) {
    const age = now - new Date(event.occurred_at).getTime();
    if (age >= 0 && age < BUCKETS * BUCKET_MS) {
      const index = BUCKETS - 1 - Math.floor(age / BUCKET_MS);
      activity[index]++;
      input[index] += event.input_tokens?.value || 0;
      output[index] += event.output_tokens?.value || 0;
    }
  }
  return { activity, input, output };
}
