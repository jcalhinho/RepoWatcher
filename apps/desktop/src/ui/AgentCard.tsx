import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import { formatCompact, formatDuration } from "./analytics";
import { costLabelText, useSubscription } from "./costPreferences";
import { InfoTip } from "./Explain";
import { locale, t } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { providerFor, providers } from "./providers";

/** The one vocabulary for agent states, used by the cards, the race and the help panel. */
export function statusInfo(status: PulseStatus): { label: string; explanation: string } {
  switch (status) {
    case "looping": return { label: t("Tourne en rond", "Going in circles"), explanation: t("L’agent répète les mêmes actions sans avancer (même commande, même fichier, même enchaînement). Interviens : il consomme des tokens pour rien.", "The agent repeats the same actions without progress (same command, same file, same sequence). Step in: it burns tokens for nothing.") };
    case "blocked": return { label: t("Bloqué", "Blocked"), explanation: t("Au moins deux outils ont échoué d’affilée. Jette un œil à sa session.", "At least two tools failed in a row. Have a look at its session.") };
    case "stalled": return { label: t("Silencieux", "Silent"), explanation: t("Un tour est en cours mais rien ne se passe depuis plus de 2 minutes. Il attend souvent une validation ou une réponse de ta part.", "A turn is open but nothing happened for over 2 minutes. It often waits for your approval or answer.") };
    case "waiting": return { label: t("T’attend", "Waiting for you"), explanation: t("Son dernier tour est terminé : il est prêt pour ton prochain message.", "Its last turn is done: it is ready for your next message.") };
    case "working": return { label: t("Au travail", "Working"), explanation: t("Il agit en ce moment : des événements arrivent depuis moins de 45 secondes.", "It is acting right now: events arrived less than 45 seconds ago.") };
    case "idle": return { label: t("Au repos", "Idle"), explanation: t("Aucune activité récente ; sa dernière session est terminée ou ancienne.", "No recent activity; its last session ended or is old.") };
    case "never": return { label: t("Pas encore vu", "Not seen yet"), explanation: t("Aucun événement reçu de cet agent. Vérifie son connecteur dans l’onglet Connecteurs.", "No event received from this agent. Check its connector in the Connectors tab.") };
  }
}

const fallbackProvider = providers.find((provider) => provider.eventKey === "custom")!;

export function since(at: number | null, now: number) {
  if (at === null) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return t("à l’instant", "just now");
  if (seconds < 60) return t(`il y a ${seconds} s`, `${seconds}s ago`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t(`il y a ${minutes} min`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t(`il y a ${hours} h`, `${hours} h ago`) : t(`il y a ${Math.floor(hours / 24)} j`, `${Math.floor(hours / 24)} d ago`);
}

function Metric({ label, value, explanation, tone, compact }: { label: string; value: string; explanation: string; tone?: "bad"; compact: boolean }) {
  return <div className={`agent-metric ${tone ?? ""}`} title={compact ? explanation : undefined}>
    <dt>{label}{!compact && <InfoTip label={t(`Explication : ${label}`, `About: ${label}`)}>{explanation}</InfoTip>}</dt>
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
  const status = statusInfo(pulse.status);
  const [subscription] = useSubscription(pulse.key);
  const session = pulse.session;
  const failRate = session && session.toolCalls ? Math.round((session.failures / session.toolCalls) * 100) : 0;
  const tokens = session && (session.inputTokens !== null || session.outputTokens !== null) ? (session.inputTokens ?? 0) + (session.outputTokens ?? 0) : null;
  const sparkMax = Math.max(1, ...pulse.spark);
  const folder = pulse.project?.project_path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  const place = repository ?? (folder ? t(`${folder} (hors workspace)`, `${folder} (outside the workspace)`) : null);
  const statusNote = pulse.status === "looping" && pulse.loop ? t(`Boucle détectée : ${pulse.loop.evidence}.`, `Loop detected: ${pulse.loop.evidence}.`) : pulse.status === "blocked" ? t(`${pulse.failureStreak} échecs d’affilée`, `${pulse.failureStreak} failures in a row`) : status.explanation;

  // The whole card leads to the agent; its own buttons (explanations, raw data) keep their role.
  const canGo = Boolean(onGoTo && pulse.session);
  const go = (event: MouseEvent | KeyboardEvent) => {
    if (!canGo || (event.target as HTMLElement).closest("button, a, summary, details")) return;
    if ("key" in event && event.key !== "Enter") return;
    onGoTo!(pulse);
  };

  return <article className={`agent-card status-${pulse.status} ${compact ? "compact" : ""} ${canGo ? "clickable" : ""}`} style={{ "--agent-color": provider.color } as CSSProperties} aria-label={`${provider.name} : ${status.label}`} onClick={go} onKeyDown={go} tabIndex={canGo ? 0 : undefined} title={canGo ? t("Cliquer pour aller là où travaille l’agent", "Click to go where the agent works") : undefined}>
    <header className="agent-card-header">
      <ProviderMark provider={provider} />
      <div className="agent-card-title">
        <b>{provider.name}</b>
        <span>{place ? t(`dans ${place}`, `in ${place}`) : t("dépôt inconnu", "unknown repository")}</span>
      </div>
      <span className="status-badge" title={status.explanation}>{status.label}</span>
    </header>
    {canGo && <button className="go-to-agent" onClick={() => onGoTo!(pulse)}><ArrowUpRight size={14} />{pulse.status === "waiting" || pulse.status === "stalled" ? t("Lui répondre", "Reply") : t("Aller à l’agent", "Go to agent")}</button>}

    {pulse.status !== "working" && pulse.status !== "never" && <p className="agent-card-note">{statusNote}</p>}

    {pulse.current ? <div className={`agent-now tone-${pulse.current.tone}`}>
      <span className="agent-now-label">{pulse.status === "working" ? t("En train de", "Now") : t("Dernière action", "Last action")} · {since(pulse.current.at, now)}</span>
      <b>{pulse.current.text}</b>
      {pulse.current.detail && <small>{pulse.current.detail}</small>}
    </div> : <p className="agent-card-note">{status.explanation}</p>}

    {session && <dl className="agent-metrics">
      <Metric compact={compact} label={pulse.turnStartedAt !== null ? t("Tour en cours", "Current turn") : t("Tours", "Turns")} value={pulse.turnStartedAt !== null ? formatDuration(now - pulse.turnStartedAt) : String(session.turns)} explanation={pulse.turnStartedAt !== null ? t("Temps écoulé depuis ton dernier message à l’agent.", "Time since your last message to the agent.") : t("Nombre d’échanges (ton message puis le travail de l’agent) dans sa session actuelle.", "Number of exchanges (your message, then the agent’s work) in its current session.")} />
      <Metric compact={compact} label={t("Outils", "Tools")} value={failRate ? t(`${session.toolCalls} · ${failRate} % d’échecs`, `${session.toolCalls} · ${failRate}% failed`) : String(session.toolCalls)} tone={failRate >= 20 ? "bad" : undefined} explanation={t("Actions lancées par l’agent dans sa session (lire, modifier, exécuter…) et la part qui a échoué.", "Actions the agent ran in its session (read, edit, run…) and the share that failed.")} />
      <Metric compact={compact} label="Tokens" value={tokens === null ? t("non fournis", "not reported") : formatCompact(tokens)} explanation={tokens === null ? t("Ce connecteur ne transmet pas de compteur de tokens pour cette session.", "This connector reports no token counter for this session.") : t(`Volume de texte traité par le modèle dans la session : ${formatCompact(session.inputTokens ?? 0)} lus (contexte, cache compris) et ${formatCompact(session.outputTokens ?? 0)} écrits.`, `Text processed by the model in the session: ${formatCompact(session.inputTokens ?? 0)} read (context, cache included) and ${formatCompact(session.outputTokens ?? 0)} written.`)} />
      {session.cost !== null
        ? <Metric compact={compact} label={costLabelText(pulse.key, subscription)} value={"≈ " + session.cost.toLocaleString(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 2 })} explanation={subscription ? t("Ce que ces tokens coûteraient au tarif API. Tu es au forfait : ce n’est pas ce que tu paies.", "What these tokens would cost at API prices. You are on a subscription: this is not what you pay.") : t("Estimation à partir des prix publics du modèle et des tokens fournis. Ce n’est pas une facture : forfaits et remises ne sont pas connus.", "Estimate from the model’s public prices and the reported tokens. Not an invoice: plans and discounts are unknown.")} />
        : <Metric compact={compact} label={t("Fichiers modifiés", "Files edited")} value={String(session.filesChanged)} explanation={t("Fichiers différents que l’agent a modifiés pendant sa session (d’après les outils qu’il a utilisés).", "Distinct files the agent edited in its session (from the tools it used).")} />}
    </dl>}

    <div className="agent-spark">
      <div className="agent-spark-bars" role="img" aria-label={t("Activité minute par minute sur les 15 dernières minutes", "Activity per minute over the last 15 minutes")}>{pulse.spark.map((value, index) => <i key={index} style={{ height: `${value ? Math.max(14, (value / sparkMax) * 100) : 6}%` }} className={value ? "" : "empty"} title={t(`${value} événement${value > 1 ? "s" : ""}, il y a ${pulse.spark.length - index} min`, `${value} event${value === 1 ? "" : "s"}, ${pulse.spark.length - index} min ago`)} />)}</div>
      <small>{t("activité · 15 dernières minutes", "activity · last 15 minutes")}</small>
    </div>

    {pulse.recent.length > 1 && <ol className="agent-log" aria-label={t("Actions précédentes", "Previous actions")}>{pulse.recent.slice(1, compact ? 3 : 4).map((action) => <li key={action.id} className={`tone-${action.tone}`}><span>{action.text}</span><time>{since(action.at, now)}</time></li>)}</ol>}
    {!compact && session?.model && <footer className="agent-card-footer">{t("Modèle", "Model")} : {session.model}</footer>}
  </article>;
}
