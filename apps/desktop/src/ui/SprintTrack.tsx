import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import type { AgentPulse } from "./agentPulse";
import { STATUS_INFO } from "./AgentCard";
import { deriveRaceState, isTurnComplete } from "./race";
import type { RaceLane } from "./SprintTrack3D";
import { oneOf, usePreference } from "./preferences";
import { raceProviders } from "./providers";
import { ProviderMark } from "./ProviderBadges";
import { Resizable } from "./Resizable";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

const SprintTrack3D = lazy(() => import("./SprintTrack3D"));

/** A bubble stays above a runner while its latest action is this recent. */
const BUBBLE_MAX_AGE_MS = 3 * 60_000;
const isTrackMode = oneOf("3d", "2d");

/**
 * The race: each agent is a runner that moves forward when it acts, trips on a failed tool and
 * crosses the line when a turn ends. Bubbles repeat the action shown on the agent cards.
 */
export function SprintTrack({ events, pulses, liveEventIds, onGoTo }: { events: SessionEvent[]; pulses: Map<string, AgentPulse>; liveEventIds: Record<string, string>; onGoTo?: (pulse: AgentPulse) => void }) {
  // The race advances with elapsed time, so only this panel ticks every second.
  const now = useNow(1000);
  const [mode, setMode] = usePreference("race-mode", supportsWebGL() ? "3d" : "2d", isTrackMode);
  const reducedMotion = usePrefersReducedMotion();
  const lanes = raceProviders.map((provider) => {
    const state = deriveRaceState(provider.eventKey, events, now);
    const pulse = pulses.get(provider.eventKey);
    const isLiveEvent = Boolean(state.latest && liveEventIds[provider.eventKey] === state.latest.event_id && now - Date.parse(state.latest.occurred_at) < 8_000);
    const bubble = pulse?.current && now - pulse.current.at < BUBBLE_MAX_AGE_MS ? pulse.current : null;
    const cue: RaceLane["cue"] = state.latest?.kind === "tool_failed" ? "fall" : state.latest?.kind === "session_ended" || (state.latest?.kind === "checkpoint" && isTurnComplete(provider.eventKey, state.latest)) ? "finish" : "leap";
    return { provider, state, isLiveEvent, cue, bubble, pulse, label: STATUS_INFO[pulse?.status ?? "never"].label };
  });

  return <div className={`race race-${mode}`}>
    <div className="segmented" role="group" aria-label="Rendu de la course">
      {(["3d", "2d"] as const).map((value) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "3d" ? "3D" : "2D (plus léger)"}</button>)}
    </div>
    {mode === "3d"
      ? <Resizable id="race-stage" defaultHeight={400} min={220} max={1200} label="la course">
          <div className="race-stage"><Suspense fallback={<div className="race-loading">Chargement du stade…</div>}>
            <SprintTrack3D reducedMotion={reducedMotion} lanes={lanes.map(({ provider, state, isLiveEvent, cue, bubble, pulse }) => ({ id: provider.id, name: provider.name, color: provider.color, status: state.status, progress: state.progress, cue, cueKey: isLiveEvent && state.latest ? state.latest.event_id : null, bubble, mood: pulse?.status ?? "never", onSelect: pulse?.session && onGoTo ? () => onGoTo(pulse) : undefined }))} />
          </Suspense></div>
        </Resizable>
      : <div className="race-lanes">
          {lanes.map(({ provider, state, isLiveEvent, cue, bubble, label }) => {
            const moving = state.status === "running" || state.status === "recent";
            return <div className={`race-lane ${moving ? "moving" : ""}`} key={provider.id} style={{ "--agent-color": provider.color, "--progress": `${state.progress}%` } as CSSProperties}>
              <div className="race-lane-name"><ProviderMark provider={provider} small /><span>{provider.name}</span><small>{label}</small></div>
              <div className="race-lane-track">
                <span className="race-finish" aria-hidden="true" />
                {state.latest && <div className={`runner ${cue} ${isLiveEvent ? "new-event" : ""} ${moving ? "moving" : ""}`} key={state.latest.event_id}>
                  {bubble && <span className={`runner-bubble tone-${bubble.tone} ${state.progress > 60 ? "flipped" : ""}`} role="status">{bubble.text}{bubble.detail && <small>{bubble.detail}</small>}</span>}
                  <svg viewBox="0 0 58 52" aria-hidden="true"><g className="runner-body"><circle cx="37" cy="8" r="5" className="runner-head" /><path d="M34 15l-7 13 9 5 7-14" /><path className="arm-back" d="M31 18l-11 5-5-6" /><path className="arm-front" d="M38 18l9 3 5-6" /><path className="leg-back" d="M29 31l-10 8-8 1" /><path className="leg-front" d="M35 32l7 8 9 2" /></g></svg>
                </div>}
              </div>
            </div>;
          })}
        </div>}
    <p className="race-legend"><span><i className="legend-leap" />saute : nouvelle action</span><span><i className="legend-fall" />tombe : outil en échec</span><span><i className="legend-finish" />franchit la ligne : tour terminé</span><span><i className="legend-loop" />tourne en rond : boucle</span><span><i className="legend-wait" />lève la main : t’attend</span><span>La distance montre l’activité récente, pas l’avancement réel de la tâche.</span></p>
  </div>;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

