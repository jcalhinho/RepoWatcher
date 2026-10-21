import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { narrateEvent, type Narration } from "./activity-copy";
import { deriveRaceState, isTurnComplete } from "./race";
import type { RaceLane } from "./SprintTrack3D";
import { raceProviders } from "./providers";
import { ProviderMark } from "./ProviderBadges";
import { Resizable } from "./Resizable";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

const SprintTrack3D = lazy(() => import("./SprintTrack3D"));

/** A bubble stays up while the agent's latest action is this recent. */
const BUBBLE_MAX_AGE_MS = 3 * 60_000;
const LOG_LENGTH = 12;

type LoggedAction = Narration & { id: string; at: number };

/** Latest narratable actions per provider key, newest first. */
function recentActions(events: SessionEvent[]) {
  const byKey = new Map<string, LoggedAction[]>();
  const ordered = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  for (const event of ordered) {
    const log = byKey.get(event.provider) ?? [];
    if (log.length >= LOG_LENGTH) continue;
    const narration = narrateEvent(event);
    if (!narration) continue;
    log.push({ ...narration, id: event.event_id, at: Date.parse(event.occurred_at) });
    byKey.set(event.provider, log);
  }
  return byKey;
}

function ago(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export function SprintTrack({ events, liveEventIds }: { events: SessionEvent[]; liveEventIds: Record<string, string> }) {
  // The race advances with elapsed time, so only this panel ticks every second.
  const now = useNow(1000);
  const actions = useMemo(() => recentActions(events), [events]);
  const states = raceProviders.map((provider) => {
    const state = deriveRaceState(provider.eventKey, events, now);
    const isLiveEvent = Boolean(state.latest && liveEventIds[provider.eventKey] === state.latest.event_id && now - Date.parse(state.latest.occurred_at) < 8_000);
    const log = actions.get(provider.eventKey) ?? [];
    const bubble = log[0] && now - log[0].at < BUBBLE_MAX_AGE_MS ? log[0] : null;
    const cue: RaceLane["cue"] = state.latest?.kind === "tool_failed" ? "fall" : state.latest?.kind === "session_ended" || (state.latest?.kind === "checkpoint" && isTurnComplete(provider.eventKey, state.latest)) ? "finish" : "leap";
    const statusText = state.status === "running" ? "EN COURSE" : state.status === "recent" ? "SIGNAL RÉCENT" : state.status === "finished" ? "À L’ARRIVÉE" : state.status === "idle" ? "AU REPOS" : "À L’ÉCOUTE";
    return { provider, state, isLiveEvent, cue, statusText, bubble, log };
  });
  const running = states.filter(({ state }) => state.status === "running" || state.status === "recent").length;
  const [mode, setMode] = useState<"3d" | "2d">(() => (readStoredTrackMode() ?? (supportsWebGL() ? "3d" : "2d")));
  const reducedMotion = usePrefersReducedMotion();
  const lanes3d: RaceLane[] = states.map(({ provider, state, isLiveEvent, cue, bubble }) => ({ id: provider.id, name: provider.name, color: provider.color, status: state.status, progress: state.progress, cue, cueKey: isLiveEvent && state.latest ? state.latest.event_id : null, bubble }));
  function chooseMode(next: "3d" | "2d") {
    setMode(next);
    try { window.localStorage.setItem("repowatcher.sprint-track-mode", next); } catch { /* preference is optional */ }
  }

  return <section className={`sprint-panel mode-${mode}`} aria-label="Course en direct des agents">
    <div className="sprint-heading">
      <div><div className="sprint-kicker"><span className="sprint-live-dot" /> STADE DE TÉLÉMÉTRIE <span>·</span> 100 M</div><h1>La course des agents</h1><p>Chaque événement les fait bondir. Un échec les fait trébucher. Un tour terminé franchit la ligne.</p></div>
      <div className={`race-counter ${running ? "is-running" : ""}`}><span className="race-counter-lamps"><i /><i /><i /></span><b>{String(running).padStart(2, "0")}</b><small>{running > 1 ? "AGENTS EN MOUVEMENT" : running === 1 ? "AGENT EN MOUVEMENT" : "EN ATTENTE DU DÉPART"}</small></div>
    </div>
    <div className="track-mode" role="group" aria-label="Rendu de la piste"><button className={mode === "3d" ? "selected" : ""} onClick={() => chooseMode("3d")} aria-pressed={mode === "3d"}>3D</button><button className={mode === "2d" ? "selected" : ""} onClick={() => chooseMode("2d")} aria-pressed={mode === "2d"}>2D</button></div>
    {mode === "3d" ? <>
      <Resizable id="race-stage" defaultHeight={430} min={220} max={1200} label="la piste 3D"><div className="sprint-stage"><Suspense fallback={<div className="sprint-stage-loading">Chargement du stade…</div>}><SprintTrack3D lanes={lanes3d} reducedMotion={reducedMotion} /></Suspense></div></Resizable>
      <Resizable id="agent-logs" defaultHeight={250} min={110} max={1000} label="les journaux des agents"><div className="agent-logs">{states.map(({ provider, state, statusText, log }) => <div className={`agent-log ${state.status}`} key={provider.id} style={{ "--runner-color": provider.color } as CSSProperties}>
        <div className="agent-log-heading"><ProviderMark provider={provider} small /><span>{provider.name}</span><small>{statusText}</small><b>{state.progress} m</b></div>
        {log.length ? <ol>{log.map((action) => <li key={action.id} className={action.tone}><time title={new Date(action.at).toLocaleTimeString("fr-FR")}>{ago(action.at, now)}</time><span>{action.text}{action.detail && <small>{action.detail}</small>}</span></li>)}</ol> : <p className="agent-log-empty">Aucune action observée pour l’instant.</p>}
      </div>)}</div></Resizable>
    </> : <>
    <div className="track-axis" aria-hidden="true"><span>DÉPART</span><i>25 M</i><i>50 M</i><i>75 M</i><b>ARRIVÉE</b></div>
    <div className="sprint-lanes">
      {states.map(({ provider, state, isLiveEvent, cue, statusText, bubble }, laneIndex) => {
        const style = { "--runner-color": provider.color, "--lane-delay": `${laneIndex * 70}ms`, "--runner-progress": `${state.progress}%` } as CSSProperties;
        return <div className={`sprint-lane ${state.status}`} key={provider.id} style={style}>
          <div className="lane-identity"><ProviderMark provider={provider} small /><span>{provider.name}</span><small>{statusText}</small></div>
          <div className="lane-track">
            <div className="lane-markers" aria-hidden="true"><i /><i /><i /><i /><i /></div>
            <div className="lane-start" aria-hidden="true" />
            <div className="lane-finish" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            {state.latest ? <div className={`runner-sprite ${cue} ${isLiveEvent ? "is-new-event" : ""} ${state.status === "running" || state.status === "recent" ? "is-moving" : ""}`} key={state.latest.event_id} title={`${provider.name} · ${state.latest.kind.replaceAll("_", " ")}`}>
              {bubble && <span className={`runner-speech ${bubble.tone} ${state.progress > 60 ? "flipped" : ""}`} role="status">{bubble.text}{bubble.detail && <small>{bubble.detail}</small>}</span>}
              <svg className="runner-figure" viewBox="0 0 58 52" role="img" aria-label={`${provider.name}, ${state.latest.kind.replaceAll("_", " ")}`}>
                <g className="runner-trails"><path d="M3 17h13M0 24h12M6 31h10" /></g>
                <g className="runner-body"><circle className="runner-head" cx="37" cy="8" r="5" /><path className="runner-torso" d="M34 15l-7 13 9 5 7-14" /><path className="runner-arm arm-back" d="M31 18l-11 5-5-6" /><path className="runner-arm arm-front" d="M38 18l9 3 5-6" /><path className="runner-leg leg-back" d="M29 31l-10 8-8 1" /><path className="runner-leg leg-front" d="M35 32l7 8 9 2" /></g>
                <path className="runner-ground" d="M2 47h52" />
              </svg>
              <span className="runner-event-flash" />
            </div> : <div className="lane-empty-runner" aria-hidden="true"><span /></div>}
            <span className="lane-distance" aria-hidden="true">{state.progress} m</span>
          </div>
        </div>;
      })}
    </div>
    </>}
    <div className="sprint-footnote"><span><i className="footnote-leap" /> saut = nouvel événement</span><span><i className="footnote-fall" /> chute = échec observé</span><span>Distance visuelle = signaux reçus, pas un % d’avancement du modèle.</span></div>
  </section>;
}

function readStoredTrackMode(): "3d" | "2d" | null {
  try {
    const stored = window.localStorage.getItem("repowatcher.sprint-track-mode");
    return stored === "3d" || stored === "2d" ? stored : null;
  } catch {
    return null;
  }
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
