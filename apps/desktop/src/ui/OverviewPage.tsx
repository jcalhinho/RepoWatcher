import { Check, X } from "lucide-react";
import { t } from "./i18n";
import { AgentCard } from "./AgentCard";
import { useMemo } from "react";
import { agentPulse, sortPulses, type AgentPulse } from "./agentPulse";
import type { AnalyticsRange } from "./analytics";
import { EventFeed } from "./EventFeed";
import { EmptyState, SectionHeader } from "./Explain";
import { isBoolean, usePreference } from "./preferences";
import { agentName, useAgents } from "./providers";
import { Resizable } from "./Resizable";
import { SessionAnalytics } from "./SessionAnalytics";
import { SprintTrack } from "./SprintTrack";
import type { SessionEvent } from "./types";
import type { AnalyticsDataset } from "./useAnalyticsEvents";
import { useNow } from "./useNow";
import type { WorkspaceRepository } from "./workspace";

export type OverviewProps = {
  /** Last 24 hours in scope, for the agent cards. */
  agentEvents: SessionEvent[];
  /** Latest events in scope (race, feed). */
  events: SessionEvent[];
  /** Every stored event of the analytics window, in scope. */
  analyticsEvents: SessionEvent[];
  analytics: AnalyticsDataset;
  range: AnalyticsRange;
  onRange: (range: AnalyticsRange) => void;
  liveEventIds: Record<string, string>;
  repositoryOf?: (event: SessionEvent) => WorkspaceRepository | null;
  repositoryName: (pulse: AgentPulse) => string | null;
  onGoTo: (pulse: AgentPulse) => void;
  setup: { anyAgent: boolean; claudeHooks: boolean; workspace: boolean };
  onOpen: (tab: "connectors" | "repositories") => void;
};

/** "What are my agents doing right now?" — then how the period went, then the raw activity. */
export function OverviewPage({ agentEvents, events, analyticsEvents, analytics, range, onRange, liveEventIds, repositoryOf, repositoryName, onGoTo, setup, onOpen }: OverviewProps) {
  // The cards and the race tick every second; only this page re-renders for it.
  const now = useNow(1000);
  const agents = useAgents();
  const pulses = useMemo(() => sortPulses(agents.map((provider) => agentPulse(provider.eventKey, agentEvents, now))), [agents, agentEvents, now]);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const attention = pulses.filter((pulse) => pulse.status === "looping" || pulse.status === "blocked" || pulse.status === "stalled" || pulse.status === "waiting");
  const pulseByKey = new Map(pulses.map((pulse) => [pulse.key, pulse]));

  return <div className="page overview">
    <GettingStarted setup={setup} onOpen={onOpen} />

    <section className="page-section" aria-labelledby="agents-title">
      <SectionHeader
        title={<span id="agents-title">{t("Vos agents en ce moment", "Your agents right now")}</span>}
        description={seen.length ? (attention.length ? t(`${attention.length} agent${attention.length > 1 ? "s ont" : " a"} besoin de toi — ils sont affichés en premier.`, `${attention.length} agent${attention.length > 1 ? "s need" : " needs"} you — shown first.`) : t("Aucun agent n’a besoin de toi pour l’instant.", "No agent needs you right now.")) : t("Aucun agent observé pour l’instant.", "No agent observed yet.")}
        details={t("Une carte par agent observé, celles qui demandent ton attention en premier. Clique sur une carte pour aller directement dans le terminal ou l’éditeur où travaille l’agent. Le badge résume son état (survole-le pour l’explication), puis viennent son action en cours, les chiffres de sa session et son activité des 15 dernières minutes.", "One card per observed agent, those needing your attention first. Click a card to jump to the terminal or editor where the agent works. The badge sums up its state (hover for details), then come its current action, its session numbers and its activity over the last 15 minutes.")}
      />
      {seen.length
        ? <div className="agent-grid">{seen.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} repository={repositoryName(pulse)} onGoTo={onGoTo} />)}</div>
        : <EmptyState title={t("En attente d’un agent", "Waiting for an agent")} action={<button className="button" onClick={() => onOpen("connectors")}>{t("Voir les connecteurs", "See connectors")}</button>}>{t("Lance une session avec Claude Code, Codex, Gemini CLI, OpenCode ou Qwen Code : sa carte apparaîtra ici en quelques secondes.", "Start a session with Claude Code, Codex, Gemini CLI, OpenCode or Qwen Code: its card will show up here within seconds.")}</EmptyState>}
      {seen.length > 0 && seen.length < pulses.length && <p className="text-muted small">{t("Pas encore vus", "Not seen yet")} : {pulses.filter((pulse) => pulse.status === "never").map((pulse) => agentName(pulse.key)).join(", ")}.</p>}
    </section>

    <section className="page-section" aria-labelledby="race-title">
      <SectionHeader
        title={<span id="race-title">{t("La course", "The race")}</span>}
        description={t("La même activité en image : chaque agent court quand il agit. Pratique pour voir d’un coup d’œil qui travaille.", "The same activity as a picture: each agent runs when it acts. Handy to see at a glance who is working.")}
        details={t("Un coureur saute à chaque nouvelle action, trébuche quand un outil échoue et franchit la ligne quand un tour se termine. Il tourne en rond quand l’agent boucle, lève la main quand il t’attend, s’assoit quand il est silencieux et se courbe sous un ⚠ quand il est bloqué. Clique sur un coureur pour aller à l’agent. Sa bulle reprend l’action affichée sur sa carte. La distance reflète l’activité récente, pas l’avancement de la tâche.", "A runner jumps at each new action, stumbles when a tool fails and crosses the line when a turn ends. It runs in circles when the agent loops, raises a hand when it waits for you, sits when it is silent and stoops under a ⚠ when blocked. Click a runner to go to the agent. Its bubble repeats the action shown on its card. Distance reflects recent activity, not task progress.")}
      />
      <SprintTrack events={events} pulses={pulseByKey} liveEventIds={liveEventIds} onGoTo={onGoTo} />
    </section>

    <SessionAnalytics events={analyticsEvents} range={range} onRange={onRange} dataset={analytics} repositoryOf={repositoryOf} />

    <section className="page-section" aria-labelledby="feed-title">
      <SectionHeader
        title={<span id="feed-title">{t("Fil d’activité", "Activity feed")}</span>}
        description={t("Tout ce que les agents ont fait, du plus récent au plus ancien, en langage clair.", "Everything the agents did, newest first, in plain language.")}
        details={t("Chaque ligne est un événement reçu : l’heure, l’agent, ce qu’il a fait et, quand c’est connu, le détail (fichier, durée, tokens). « données brutes » affiche l’enregistrement exact.", "Each line is an event received: time, agent, what it did and, when known, details (file, duration, tokens). “raw data” shows the exact record.")}
      />
      <Resizable id="activity-feed" defaultHeight={340} min={140} max={1600} label={t("le fil d’activité", "the activity feed")}>
        {events.length ? <EventFeed events={events} /> : <EmptyState title={t("Rien pour l’instant", "Nothing yet")}>{t("Les actions de tes agents s’afficheront ici dès qu’ils travailleront.", "Your agents’ actions will show up here as soon as they work.")}</EmptyState>}
      </Resizable>
    </section>
  </div>;
}

/** Three steps shown until they are all done or the guide is dismissed. */
function GettingStarted({ setup, onOpen }: { setup: OverviewProps["setup"]; onOpen: OverviewProps["onOpen"] }) {
  const [dismissed, setDismissed] = usePreference("getting-started-dismissed", false, isBoolean);
  const steps = [
    { done: setup.anyAgent, title: t("Observer un premier agent", "Observe a first agent"), text: t("Lance une session avec un de tes agents. Codex, Gemini CLI, OpenCode et Qwen Code sont détectés automatiquement.", "Start a session with one of your agents. Codex, Gemini CLI, OpenCode and Qwen Code are detected automatically."), action: () => onOpen("connectors"), label: t("Connecteurs", "Connectors") },
    { done: setup.claudeHooks, title: t("Brancher Claude Code (si tu l’utilises)", "Set up Claude Code (if you use it)"), text: t("Claude Code a besoin d’un petit bloc dans ses réglages pour envoyer ses actions.", "Claude Code needs a small block in its settings to send its actions."), action: () => onOpen("connectors"), label: t("Configurer", "Set up") },
    { done: setup.workspace, title: t("Choisir ton workspace", "Pick your workspace"), text: t("Le dossier qui contient tes projets : l’app rattache alors chaque action au bon dépôt.", "The folder holding your projects: the app then links each action to the right repository."), action: () => onOpen("repositories"), label: t("Dépôts", "Repositories") }
  ];
  if (dismissed || steps.every((step) => step.done)) return null;
  return <section className="getting-started" aria-labelledby="getting-started-title">
    <header><h2 id="getting-started-title">{t("Bien démarrer", "Getting started")}</h2><button className="icon-button" onClick={() => setDismissed(true)} aria-label={t("Masquer le guide de démarrage", "Hide the getting started guide")}><X size={15} /></button></header>
    <ol>{steps.map((step) => <li key={step.title} className={step.done ? "done" : ""}>
      <span className="step-check" aria-hidden="true">{step.done ? <Check size={14} /> : null}</span>
      <span><b>{step.title}</b><small>{step.done ? t("Fait.", "Done.") : step.text}</small></span>
      {!step.done && <button className="button small" onClick={step.action}>{step.label}</button>}
    </li>)}</ol>
  </section>;
}
