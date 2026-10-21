import { Check, X } from "lucide-react";
import { AgentCard } from "./AgentCard";
import { useMemo } from "react";
import { agentPulse, sortPulses, type AgentPulse } from "./agentPulse";
import type { AnalyticsRange } from "./analytics";
import { EventFeed } from "./EventFeed";
import { EmptyState, SectionHeader } from "./Explain";
import { isBoolean, usePreference } from "./preferences";
import { activeProviders, providers } from "./providers";
import { Resizable } from "./Resizable";
import { SessionAnalytics } from "./SessionAnalytics";
import { SprintTrack } from "./SprintTrack";
import type { SessionEvent } from "./types";
import type { AnalyticsDataset } from "./useAnalyticsEvents";
import { useNow } from "./useNow";
import type { WorkspaceRepository } from "./workspace";

const providerNames = new Map(providers.map((provider) => [provider.eventKey, provider.name]));

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
  setup: { anyAgent: boolean; claudeHooks: boolean; workspace: boolean };
  onOpen: (tab: "connectors" | "repositories") => void;
};

/** "What are my agents doing right now?" — then how the period went, then the raw activity. */
export function OverviewPage({ agentEvents, events, analyticsEvents, analytics, range, onRange, liveEventIds, repositoryOf, repositoryName, setup, onOpen }: OverviewProps) {
  // The cards and the race tick every second; only this page re-renders for it.
  const now = useNow(1000);
  const pulses = useMemo(() => sortPulses(activeProviders.map((provider) => agentPulse(provider.eventKey, agentEvents, now))), [agentEvents, now]);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const attention = pulses.filter((pulse) => pulse.status === "blocked" || pulse.status === "stalled" || pulse.status === "waiting");
  const pulseByKey = new Map(pulses.map((pulse) => [pulse.key, pulse]));

  return <div className="page overview">
    <GettingStarted setup={setup} onOpen={onOpen} />

    <section className="page-section" aria-labelledby="agents-title">
      <SectionHeader
        title={<span id="agents-title">Vos agents en ce moment</span>}
        description={seen.length ? (attention.length ? `${attention.length} agent${attention.length > 1 ? "s ont" : " a"} besoin de toi — ils sont affichés en premier.` : "Aucun agent n’a besoin de toi pour l’instant.") : "Aucun agent observé pour l’instant."}
        details="Une carte par agent observé, celles qui demandent ton attention en premier. Le badge résume son état (survole-le pour l’explication), puis viennent son action en cours, les chiffres de sa session et son activité des 15 dernières minutes."
      />
      {seen.length
        ? <div className="agent-grid">{seen.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} repository={repositoryName(pulse)} />)}</div>
        : <EmptyState title="En attente d’un agent" action={<button className="button" onClick={() => onOpen("connectors")}>Voir les connecteurs</button>}>Lance une session avec Claude Code, Codex, Gemini CLI, OpenCode ou Qwen Code : sa carte apparaîtra ici en quelques secondes.</EmptyState>}
      {seen.length > 0 && seen.length < pulses.length && <p className="text-muted small">Pas encore vus : {pulses.filter((pulse) => pulse.status === "never").map((pulse) => providerNames.get(pulse.key) ?? pulse.key).join(", ")}.</p>}
    </section>

    <section className="page-section" aria-labelledby="race-title">
      <SectionHeader
        title={<span id="race-title">La course</span>}
        description="La même activité en image : chaque agent court quand il agit. Pratique pour voir d’un coup d’œil qui travaille."
        details="Un coureur saute à chaque nouvelle action, trébuche quand un outil échoue et franchit la ligne quand un tour se termine. Sa bulle reprend l’action affichée sur sa carte. La distance reflète l’activité récente, pas l’avancement de la tâche."
      />
      <SprintTrack events={events} pulses={pulseByKey} liveEventIds={liveEventIds} />
    </section>

    <SessionAnalytics events={analyticsEvents} range={range} onRange={onRange} dataset={analytics} repositoryOf={repositoryOf} />

    <section className="page-section" aria-labelledby="feed-title">
      <SectionHeader
        title={<span id="feed-title">Fil d’activité</span>}
        description="Tout ce que les agents ont fait, du plus récent au plus ancien, en langage clair."
        details="Chaque ligne est un événement reçu : l’heure, l’agent, ce qu’il a fait et, quand c’est connu, le détail (fichier, durée, tokens). « données brutes » affiche l’enregistrement exact."
      />
      <Resizable id="activity-feed" defaultHeight={340} min={140} max={1600} label="le fil d’activité">
        {events.length ? <EventFeed events={events} /> : <EmptyState title="Rien pour l’instant">Les actions de tes agents s’afficheront ici dès qu’ils travailleront.</EmptyState>}
      </Resizable>
    </section>
  </div>;
}

/** Three steps shown until they are all done or the guide is dismissed. */
function GettingStarted({ setup, onOpen }: { setup: OverviewProps["setup"]; onOpen: OverviewProps["onOpen"] }) {
  const [dismissed, setDismissed] = usePreference("getting-started-dismissed", false, isBoolean);
  const steps = [
    { done: setup.anyAgent, title: "Observer un premier agent", text: "Lance une session avec un de tes agents. Codex, Gemini CLI, OpenCode et Qwen Code sont détectés automatiquement.", action: () => onOpen("connectors"), label: "Connecteurs" },
    { done: setup.claudeHooks, title: "Brancher Claude Code (si tu l’utilises)", text: "Claude Code a besoin d’un petit bloc dans ses réglages pour envoyer ses actions.", action: () => onOpen("connectors"), label: "Configurer" },
    { done: setup.workspace, title: "Choisir ton workspace", text: "Le dossier qui contient tes projets : l’app rattache alors chaque action au bon dépôt.", action: () => onOpen("repositories"), label: "Dépôts" }
  ];
  if (dismissed || steps.every((step) => step.done)) return null;
  return <section className="getting-started" aria-labelledby="getting-started-title">
    <header><h2 id="getting-started-title">Bien démarrer</h2><button className="icon-button" onClick={() => setDismissed(true)} aria-label="Masquer le guide de démarrage"><X size={15} /></button></header>
    <ol>{steps.map((step) => <li key={step.title} className={step.done ? "done" : ""}>
      <span className="step-check" aria-hidden="true">{step.done ? <Check size={14} /> : null}</span>
      <span><b>{step.title}</b><small>{step.done ? "Fait." : step.text}</small></span>
      {!step.done && <button className="button small" onClick={step.action}>{step.label}</button>}
    </li>)}</ol>
  </section>;
}
