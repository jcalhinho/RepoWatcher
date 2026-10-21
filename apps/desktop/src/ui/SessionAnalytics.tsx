import { useMemo } from "react";
import {
  RANGE_LABELS, bucketSeries, eventsInRange, formatCompact, formatDuration, modelsUsed, timeAxis, toolCallsByAgent,
  tokensByAgent, topFiles, topTools, totalTokens, turnDurations, type AnalyticsRange
} from "./analytics";
import { BarList, LineChart, type BarRow } from "./charts";
import { InfoTip } from "./Explain";
import { Resizable } from "./Resizable";
import { providerFor, useAgents } from "./providers";
import { sessionKey, type SessionEvent } from "./types";
import type { WorkspaceRepository } from "./workspace";
import type { AnalyticsDataset } from "./useAnalyticsEvents";
import { useNow } from "./useNow";

// Status and neutral colors: never reused for an agent identity.
const FAILURE = "#d03b3b";
const NEUTRAL_STRONG = "#c3cad8";
const NEUTRAL_SOFT = "#5f6a7f";
const SINGLE_SERIES = "#7d8aa3";

const nameOf = (key: string) => providerFor(key)?.name ?? key;
const colorOf = (key: string) => providerFor(key)?.color ?? SINGLE_SERIES;
const shortPath = (path: string) => path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");

export function SessionAnalytics({ events, range, onRange, dataset, repositoryOf }: {
  events: SessionEvent[];
  range: AnalyticsRange;
  onRange: (range: AnalyticsRange) => void;
  /** How complete `events` is for the window. */
  dataset: AnalyticsDataset;
  /** Set when a multi-repository workspace is shown unfiltered. */
  repositoryOf?: (event: SessionEvent) => WorkspaceRepository | null;
}) {
  const now = useNow(10_000);
  const agents = useAgents();
  const CHART_KEYS = useMemo(() => agents.map((provider) => provider.eventKey), [agents]);

  const data = useMemo(() => {
    const axis = timeAxis(events, range, now);
    const scoped = eventsInRange(events, axis);
    const tokens = scoped.reduce((sum, event) => sum + totalTokens(event), 0);
    return {
      axis,
      scoped,
      sessions: new Set(scoped.map(sessionKey)).size,
      toolCalls: scoped.filter((event) => event.kind === "tool_started").length,
      failures: scoped.filter((event) => event.kind === "tool_failed").length,
      tokens,
      activity: bucketSeries(scoped, CHART_KEYS, axis),
      tokenSeries: bucketSeries(scoped, CHART_KEYS, axis, totalTokens),
      calls: toolCallsByAgent(scoped, CHART_KEYS),
      tools: topTools(scoped),
      files: topFiles(scoped),
      agentTokens: tokensByAgent(scoped, CHART_KEYS),
      turns: turnDurations(scoped, CHART_KEYS),
      models: modelsUsed(scoped),
      repositories: repositoryOf ? eventsPerRepository(scoped, repositoryOf) : []
    };
  }, [events, range, now, repositoryOf, CHART_KEYS]);

  const lines = (series: typeof data.activity) => series.map((line) => ({ key: line.key, label: nameOf(line.key), color: colorOf(line.key), values: line.values }));
  const callRows: BarRow[] = data.calls.map((row) => ({
    key: row.key, label: nameOf(row.key), title: `${nameOf(row.key)} · ${row.succeeded + row.failed} appels terminés`, marker: colorOf(row.key),
    segments: [{ value: row.succeeded, color: colorOf(row.key), label: "réussis" }, { value: row.failed, color: FAILURE, label: "échecs", pattern: true }],
    valueLabel: row.failed ? `${row.succeeded + row.failed} · ${Math.round((row.failed / (row.succeeded + row.failed)) * 100)} % d’échecs` : String(row.succeeded)
  }));
  const toolRows: BarRow[] = data.tools.map((row) => ({
    key: row.name, label: row.name, title: `Outil ${row.name}`,
    segments: [{ value: row.calls, color: SINGLE_SERIES, label: "appels" }, { value: row.failed, color: FAILURE, label: "échecs", pattern: true }],
    valueLabel: row.failed ? `${row.calls} · ${row.failed} ✗` : String(row.calls)
  }));
  const fileRows: BarRow[] = data.files.map((row) => ({
    key: row.path, label: shortPath(row.path), title: row.path,
    segments: [{ value: row.writes, color: NEUTRAL_STRONG, label: "modifications" }, { value: row.reads, color: NEUTRAL_SOFT, label: "lectures" }],
    valueLabel: `${row.writes} modif. · ${row.reads} lus`
  }));
  const tokenRows: BarRow[] = data.agentTokens.map((row) => ({
    key: row.key, label: nameOf(row.key), title: `${nameOf(row.key)} · tokens fournis par le connecteur`, marker: colorOf(row.key),
    segments: [{ value: row.input, color: colorOf(row.key), label: "entrée (lus)" }, { value: row.output, color: colorOf(row.key), label: "sortie (écrits)", pattern: true }],
    valueLabel: `${formatCompact(row.input)} / ${formatCompact(row.output)}`
  }));
  const turnRows: BarRow[] = data.turns.map((row) => ({
    key: row.key, label: nameOf(row.key), title: `${nameOf(row.key)} · ${row.turns} tours mesurés · le plus long : ${formatDuration(row.longestMs)}`, marker: colorOf(row.key),
    segments: [{ value: row.averageMs, color: colorOf(row.key), label: "durée moyenne" }],
    valueLabel: `${formatDuration(row.averageMs)} · ${row.turns} tours`
  }));
  const modelRows: BarRow[] = data.models.map((row) => ({
    key: row.model, label: row.model, title: `${row.model} · ${row.requests} requêtes`,
    segments: [{ value: row.tokens, color: SINGLE_SERIES, label: "tokens" }],
    valueLabel: `${formatCompact(row.tokens)} · ${row.requests} req.`
  }));

  const repositoryRows: BarRow[] = data.repositories.map((row) => ({
    key: row.path, label: row.name, title: `${row.name} · ${row.total} événements`,
    segments: CHART_KEYS.map((key) => ({ value: row.byAgent.get(key) ?? 0, color: colorOf(key), label: nameOf(key) })),
    valueLabel: String(row.total)
  }));
  const summary = [
    `${data.sessions} session${data.sessions > 1 ? "s" : ""}`,
    `${formatCompact(data.scoped.length)} événements`,
    `${formatCompact(data.toolCalls)} appels d’outils`,
    data.failures ? `${data.failures} échec${data.failures > 1 ? "s" : ""}` : null,
    data.tokens ? `${formatCompact(data.tokens)} tokens` : null
  ].filter(Boolean).join(" · ");
  const empty = range === "all" ? "Aucun événement chargé pour l’instant." : `Rien sur ${RANGE_LABELS[range]} — essaie « Tout ».`;

  const scope = dataset.truncated
    ? { tone: "warn", text: `Calculé sur les ${formatCompact(dataset.events.length)} événements les plus récents, sur ${formatCompact(dataset.total)} enregistrés pour cette période : choisis une période plus courte pour des totaux complets.` }
    : dataset.source === "loaded"
      ? { tone: "warn", text: "Aperçu : calculé seulement sur les événements affichés, sans la base locale." }
      : { tone: "ok", text: "Calculé sur tous les événements enregistrés pendant cette période." };

  return <section className="page-section" aria-labelledby="analytics-title">
    <header className="section-header level-2">
      <div className="section-header-text">
        <h2 id="analytics-title">Analyse<InfoTip label="Comment lire l’analyse ?">Chaque graphique répond à une question sur la période choisie. Survole une courbe ou une barre pour voir les valeurs exactes. Les couleurs identifient toujours le même agent ; le rouge hachuré signale des échecs.</InfoTip></h2>
        <p>{summary || "Aucune activité sur cette période."}</p>
        <p className={`data-scope tone-${scope.tone}`}>{scope.text}</p>
      </div>
      <div className="section-header-actions">
        <div className="segmented" role="group" aria-label="Période analysée">{(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((key) => <button key={key} aria-pressed={key === range} onClick={() => onRange(key)}>{RANGE_LABELS[key]}</button>)}</div>
      </div>
    </header>
    <Resizable id="analytics-lines" defaultHeight={300} min={180} max={1000} label="les courbes">
      <div className="chart-grid two">
        <ChartCard title="Quand mes agents travaillent-ils ?" explain="Nombre d’événements reçus (actions, messages, fins de tour) par tranche de temps, un trait par agent. Un pic = une période de travail intense."><LineChart series={lines(data.activity)} axis={data.axis} format={formatCompact} unit="événements" emptyText={empty} /></ChartCard>
        <ChartCard title="Combien de tokens consomment-ils ?" explain="Tokens traités par le modèle à chaque tranche (texte lu, y compris le cache, et texte écrit), tels que fournis par chaque agent. Les agents qui ne transmettent pas ce compteur n’apparaissent pas."><LineChart series={lines(data.tokenSeries)} axis={data.axis} format={formatCompact} unit="tokens" emptyText="Aucun compteur de tokens fourni sur cette période." /></ChartCard>
      </div>
    </Resizable>
    <Resizable id="analytics-bars" defaultHeight={560} min={220} max={1600} label="les graphiques en barres">
      <div className="chart-grid three">
        <ChartCard title="Qui agit le plus, et qui échoue ?" explain="Actions terminées par agent. La partie rouge hachurée correspond aux actions en échec ; un taux élevé peut signaler un agent bloqué."><BarList rows={callRows} format={formatCompact} legend={[{ label: "échecs", color: FAILURE, pattern: true }]} emptyText="Aucune action terminée sur cette période." /></ChartCard>
        <ChartCard title="Quels outils servent le plus ?" explain="Outils lancés par tous les agents (lecture, modification, commande…), avec leurs échecs en rouge hachuré."><BarList rows={toolRows} format={formatCompact} emptyText="Aucun outil utilisé sur cette période." /></ChartCard>
        <ChartCard title="Quels fichiers sont les plus touchés ?" explain="Fichiers sur lesquels les agents ont travaillé : en clair les modifications, en foncé les simples lectures. Survole un nom pour voir son chemin complet."><BarList rows={fileRows} format={formatCompact} legend={[{ label: "modifiés", color: NEUTRAL_STRONG }, { label: "lus", color: NEUTRAL_SOFT }]} emptyText="Aucun fichier signalé sur cette période." /></ChartCard>
        <ChartCard title="Qui consomme le plus de tokens ?" explain="Tokens par agent : partie pleine = texte lu par le modèle (contexte et cache), partie hachurée = texte écrit."><BarList rows={tokenRows} format={formatCompact} emptyText="Aucun compteur de tokens fourni." /></ChartCard>
        <ChartCard title="Combien de temps dure un tour ?" explain="Durée moyenne d’un tour (de ton message jusqu’à la fin du travail de l’agent), quand l’agent la fournit. Survole une barre pour voir le tour le plus long."><BarList rows={turnRows} format={formatDuration} emptyText="Aucune durée de tour fournie sur cette période." /></ChartCard>
        {repositoryOf && <ChartCard title="Sur quels dépôts ?" explain="Événements par dépôt du workspace, découpés par agent (une couleur par agent)."><BarList rows={repositoryRows} format={formatCompact} emptyText="Aucun événement rattaché à un dépôt du workspace." /></ChartCard>}
        <ChartCard title="Quels modèles sont utilisés ?" explain="Modèles d’IA rapportés par les agents, classés par tokens consommés, avec le nombre de requêtes."><BarList rows={modelRows} format={formatCompact} emptyText="Aucun modèle rapporté sur cette période." /></ChartCard>
      </div>
    </Resizable>
  </section>;
}

function ChartCard({ title, explain, children }: { title: string; explain: string; children: React.ReactNode }) {
  return <div className="chart-card"><h3>{title}<InfoTip label={`Explication : ${title}`}>{explain}</InfoTip></h3>{children}</div>;
}

function eventsPerRepository(events: SessionEvent[], repositoryOf: (event: SessionEvent) => WorkspaceRepository | null) {
  const rows = new Map<string, { path: string; name: string; total: number; byAgent: Map<string, number> }>();
  for (const event of events) {
    const repository = repositoryOf(event);
    if (!repository) continue;
    const row = rows.get(repository.path) ?? { path: repository.path, name: repository.name, total: 0, byAgent: new Map<string, number>() };
    row.total += 1;
    row.byAgent.set(event.provider, (row.byAgent.get(event.provider) ?? 0) + 1);
    rows.set(repository.path, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total).slice(0, 12);
}
