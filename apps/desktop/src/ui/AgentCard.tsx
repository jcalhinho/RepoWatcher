import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import { formatCompact, formatDuration } from "./analytics";
import { InfoTip } from "./Explain";
import { ProviderMark } from "./ProviderBadges";
import { providerFor, providers } from "./providers";

/** The one vocabulary for agent states, used by the cards, the race and the help panel. */
export const STATUS_INFO: Record<PulseStatus, { label: string; explanation: string }> = {
  looping: { label: "Tourne en rond", explanation: "L’agent répète les mêmes actions sans avancer (même commande, même fichier, même enchaînement). Interviens : il consomme des tokens pour rien." },
  blocked: { label: "Bloqué", explanation: "Au moins deux outils ont échoué d’affilée. L’agent tourne peut-être en rond : jette un œil à sa session." },
  stalled: { label: "Silencieux", explanation: "Un tour est en cours mais rien ne se passe depuis plus de 2 minutes. Il attend souvent une validation ou une réponse de ta part." },
  waiting: { label: "T’attend", explanation: "Son dernier tour est terminé : il est prêt pour ton prochain message." },
  working: { label: "Au travail", explanation: "Il agit en ce moment : des événements arrivent depuis moins de 45 secondes." },
  idle: { label: "Au repos", explanation: "Aucune activité récente ; sa dernière session est terminée ou ancienne." },
  never: { label: "Pas encore vu", explanation: "Aucun événement reçu de cet agent. Vérifie son connecteur dans l’onglet Connecteurs." }
};

const fallbackProvider = providers.find((provider) => provider.eventKey === "custom")!;

export function since(at: number | null, now: number) {
  if (at === null) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "à l’instant";
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}

function Metric({ label, value, explanation, tone, compact }: { label: string; value: string; explanation: string; tone?: "bad"; compact: boolean }) {
  return <div className={`agent-metric ${tone ?? ""}`} title={compact ? explanation : undefined}>
    <dt>{label}{!compact && <InfoTip label={`Explication : ${label}`}>{explanation}</InfoTip>}</dt>
    <dd>{value}</dd>
  </div>;
}

/**
 * Everything worth a glance about one agent: what it does now and whether it needs you, the
 * current turn, its session's tool calls, tokens and cost, recent activity and last actions.
 * `compact` drops the inline explanations for the mini window (tooltips stay).
 */
export function AgentCard({ pulse, now, repository, compact = false, onGoTo }: { pulse: AgentPulse; now: number; repository: string | null; compact?: boolean; onGoTo?: (pulse: AgentPulse) => void }) {
  const provider = providerFor(pulse.key) ?? fallbackProvider;
  const status = STATUS_INFO[pulse.status];
  const session = pulse.session;
  const failRate = session && session.toolCalls ? Math.round((session.failures / session.toolCalls) * 100) : 0;
  const tokens = session && (session.inputTokens !== null || session.outputTokens !== null) ? (session.inputTokens ?? 0) + (session.outputTokens ?? 0) : null;
  const sparkMax = Math.max(1, ...pulse.spark);
  const place = repository ?? (pulse.project?.project_path ? `${pulse.project.project_path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)} (hors workspace)` : null);
  const statusNote = pulse.status === "looping" && pulse.loop ? `Boucle détectée : ${pulse.loop.evidence}.` : pulse.status === "blocked" ? `${pulse.failureStreak} échecs d’affilée` : status.explanation;

  // The whole card leads to the agent; its own buttons (explanations, raw data) keep their role.
  const canGo = Boolean(onGoTo && pulse.session);
  const go = (event: MouseEvent | KeyboardEvent) => {
    if (!canGo || (event.target as HTMLElement).closest("button, a, summary, details")) return;
    if ("key" in event && event.key !== "Enter") return;
    onGoTo!(pulse);
  };

  return <article className={`agent-card status-${pulse.status} ${compact ? "compact" : ""} ${canGo ? "clickable" : ""}`} style={{ "--agent-color": provider.color } as CSSProperties} aria-label={`${provider.name} : ${status.label}`} onClick={go} onKeyDown={go} tabIndex={canGo ? 0 : undefined} title={canGo ? "Cliquer pour aller là où travaille l’agent" : undefined}>
    <header className="agent-card-header">
      <ProviderMark provider={provider} />
      <div className="agent-card-title">
        <b>{provider.name}</b>
        <span>{place ? `dans ${place}` : "dépôt inconnu"}</span>
      </div>
      <span className="status-badge" title={status.explanation}>{status.label}</span>
    </header>
    {canGo && <button className="go-to-agent" onClick={() => onGoTo!(pulse)}><ArrowUpRight size={14} />{pulse.status === "waiting" || pulse.status === "stalled" ? "Lui répondre" : "Aller à l’agent"}</button>}

    {pulse.status !== "working" && pulse.status !== "never" && <p className="agent-card-note">{statusNote}</p>}

    {pulse.current ? <div className={`agent-now tone-${pulse.current.tone}`}>
      <span className="agent-now-label">{pulse.status === "working" ? "En train de" : "Dernière action"} · {since(pulse.current.at, now)}</span>
      <b>{pulse.current.text}</b>
      {pulse.current.detail && <small>{pulse.current.detail}</small>}
    </div> : <p className="agent-card-note">{status.explanation}</p>}

    {session && <dl className="agent-metrics">
      <Metric compact={compact} label={pulse.turnStartedAt !== null ? "Tour en cours" : "Tours"} value={pulse.turnStartedAt !== null ? formatDuration(now - pulse.turnStartedAt) : String(session.turns)} explanation={pulse.turnStartedAt !== null ? "Temps écoulé depuis ton dernier message à l’agent." : "Nombre d’échanges (ton message puis le travail de l’agent) dans sa session actuelle."} />
      <Metric compact={compact} label="Outils" value={failRate ? `${session.toolCalls} · ${failRate} % d’échecs` : String(session.toolCalls)} tone={failRate >= 20 ? "bad" : undefined} explanation="Actions lancées par l’agent dans sa session (lire, modifier, exécuter…) et la part qui a échoué." />
      <Metric compact={compact} label="Tokens" value={tokens === null ? "non fournis" : formatCompact(tokens)} explanation={tokens === null ? "Ce connecteur ne transmet pas de compteur de tokens pour cette session." : `Volume de texte traité par le modèle dans la session : ${formatCompact(session.inputTokens ?? 0)} lus (contexte, cache compris) et ${formatCompact(session.outputTokens ?? 0)} écrits.`} />
      {session.cost !== null
        ? <Metric compact={compact} label="Coût estimé" value={session.cost.toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 })} explanation="Estimation à partir des prix publics du modèle et des tokens fournis. Ce n’est pas une facture : forfaits et remises ne sont pas connus." />
        : <Metric compact={compact} label="Fichiers modifiés" value={String(session.filesChanged)} explanation="Fichiers différents que l’agent a modifiés pendant sa session (d’après les outils qu’il a utilisés)." />}
    </dl>}

    <div className="agent-spark">
      <div className="agent-spark-bars" role="img" aria-label="Activité minute par minute sur les 15 dernières minutes">{pulse.spark.map((value, index) => <i key={index} style={{ height: `${value ? Math.max(14, (value / sparkMax) * 100) : 6}%` }} className={value ? "" : "empty"} title={`${value} événement${value > 1 ? "s" : ""}, il y a ${pulse.spark.length - index} min`} />)}</div>
      <small>activité · 15 dernières minutes</small>
    </div>

    {pulse.recent.length > 1 && <ol className="agent-log" aria-label="Actions précédentes">{pulse.recent.slice(1, compact ? 3 : 4).map((action) => <li key={action.id} className={`tone-${action.tone}`}><span>{action.text}</span><time>{since(action.at, now)}</time></li>)}</ol>}
    {!compact && session?.model && <footer className="agent-card-footer">Modèle : {session.model}</footer>}
  </article>;
}
