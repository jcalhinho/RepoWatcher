import { useMemo, type CSSProperties } from "react";
import { Maximize2, Pin, PinOff } from "lucide-react";
import { agentPulse, sortPulses, type AgentPulse, type PulseStatus } from "./agentPulse";
import { formatCompact, formatDuration } from "./analytics";
import { ProviderMark } from "./ProviderBadges";
import { chartProviders, providers } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

const STATUS_COPY: Record<PulseStatus, { label: string; hint: string }> = {
  blocked: { label: "BLOQUÉ", hint: "échecs d’affilée" },
  stalled: { label: "SILENCIEUX", hint: "tour ouvert sans activité — validation attendue ?" },
  waiting: { label: "T’ATTEND", hint: "tour terminé, prêt pour ton prochain prompt" },
  working: { label: "EN COURS", hint: "" },
  idle: { label: "AU REPOS", hint: "" },
  never: { label: "PAS VU", hint: "" }
};

const byKey = new Map(providers.map((provider) => [provider.eventKey, provider]));

function since(at: number | null, now: number) {
  if (at === null) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Compact always-visible view: one card per agent with only what needs a glance. */
export function MiniView({ events, collectorState, pinned, onTogglePin, onExpand }: { events: SessionEvent[]; collectorState: string; pinned: boolean; onTogglePin: () => void; onExpand: () => void }) {
  const now = useNow(1000);
  const pulses = useMemo(() => sortPulses(chartProviders.map((provider) => agentPulse(provider.eventKey, events, now))), [events, now]);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const unseen = pulses.filter((pulse) => pulse.status === "never");
  const counts = (status: PulseStatus) => pulses.filter((pulse) => pulse.status === status).length;
  const attention = counts("blocked") + counts("stalled") + counts("waiting");

  return <div className="mini-view">
    <header className="mini-header">
      <div className="mini-title"><span className={`status-led ${collectorState === "listening" ? "active" : collectorState.startsWith("error") ? "failed" : ""}`} /><b>Agents</b>
        <span className="mini-counts">{counts("working")} en cours{attention ? <> · <em>{attention} à voir</em></> : null}</span>
      </div>
      <div className="mini-actions">
        <button onClick={onTogglePin} aria-pressed={pinned} title={pinned ? "Ne plus garder au premier plan" : "Garder au premier plan"} aria-label={pinned ? "Désépingler la fenêtre" : "Épingler la fenêtre au premier plan"}>{pinned ? <Pin size={14} /> : <PinOff size={14} />}</button>
        <button onClick={onExpand} title="Revenir au tableau de bord complet" aria-label="Revenir au tableau de bord complet"><Maximize2 size={14} /></button>
      </div>
    </header>
    <div className="mini-cards">
      {seen.length ? seen.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} />) : <div className="mini-empty">Aucun agent observé depuis le lancement. Démarre une session Claude Code, Codex, Gemini CLI, OpenCode, Cursor ou Qwen Code.</div>}
    </div>
    {unseen.length > 0 && <footer className="mini-footer">Pas encore vus : {unseen.map((pulse) => byKey.get(pulse.key)?.name ?? pulse.key).join(", ")}</footer>}
  </div>;
}

function AgentCard({ pulse, now }: { pulse: AgentPulse; now: number }) {
  const provider = byKey.get(pulse.key)!;
  const copy = STATUS_COPY[pulse.status];
  const session = pulse.session;
  const failRate = session && session.toolCalls ? Math.round((session.failures / session.toolCalls) * 100) : 0;
  const hint = pulse.status === "blocked" ? `${pulse.failureStreak} ${copy.hint}` : pulse.status === "idle" ? `depuis ${since(pulse.lastEventAt, now)}` : copy.hint;
  const sparkMax = Math.max(1, ...pulse.spark);
  return <article className={`mini-card ${pulse.status}`} style={{ "--agent-color": provider.color } as CSSProperties}>
    <div className="mini-card-top">
      <ProviderMark provider={provider} small />
      <b className="mini-name">{provider.name}</b>
      <span className="mini-status">{copy.label}</span>
      <time className="mini-age" title="Dernier événement">{since(pulse.lastEventAt, now)}</time>
    </div>
    {hint && <div className="mini-hint">{hint}</div>}
    {pulse.current && <div className={`mini-now ${pulse.current.tone}`}><span>{pulse.current.text}</span>{pulse.current.detail && <small>{pulse.current.detail}</small>}</div>}
    <dl className="mini-metrics">
      <div><dt>Tour</dt><dd>{pulse.turnStartedAt !== null ? formatDuration(now - pulse.turnStartedAt) : session ? `${session.turns} fait${session.turns > 1 ? "s" : ""}` : "—"}</dd></div>
      <div><dt>Outils</dt><dd>{session ? session.toolCalls : "—"}{failRate > 0 && <small className="bad"> · {failRate} % ✗</small>}</dd></div>
      <div title={session && (session.inputTokens !== null || session.outputTokens !== null) ? `${formatCompact(session.inputTokens ?? 0)} lus · ${formatCompact(session.outputTokens ?? 0)} écrits` : undefined}><dt>Tokens</dt><dd>{session && (session.inputTokens !== null || session.outputTokens !== null) ? formatCompact((session.inputTokens ?? 0) + (session.outputTokens ?? 0)) : "—"}</dd></div>
      <div>{session?.cost !== null && session?.cost !== undefined ? <><dt title="Coût estimé à partir des prix publiés">Coût est.</dt><dd>{session.cost.toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}</dd></> : <><dt title="Fichiers modifiés dans la session">Modifiés</dt><dd>{session ? session.filesChanged : "—"}</dd></>}</div>
    </dl>
    <div className="mini-spark" aria-label="Événements par minute, 15 dernières minutes" role="img">{pulse.spark.map((value, index) => <i key={index} style={{ height: `${Math.max(value ? 12 : 4, (value / sparkMax) * 100)}%`, opacity: value ? 1 : 0.35 }} title={`${value} événement${value > 1 ? "s" : ""}, il y a ${pulse.spark.length - index} min`} />)}</div>
    {pulse.recent.length > 1 && <ol className="mini-log">{pulse.recent.slice(1, 4).map((action) => <li key={action.id} className={action.tone}><time>{since(action.at, now)}</time><span>{action.text}</span></li>)}</ol>}
    {session?.model && <div className="mini-model">{session.model}</div>}
  </article>;
}
