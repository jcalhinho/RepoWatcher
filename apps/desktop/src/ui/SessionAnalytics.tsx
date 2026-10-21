import { useMemo } from "react";
import {
  RANGES, bucketSeries, rangeLabel, eventsInRange, formatCompact, formatDuration, modelsUsed, timeAxis, toolCallsByAgent,
  tokensByAgent, topFiles, topTools, totalTokens, turnDurations, type AnalyticsRange
} from "./analytics";
import { BarList, LineChart, type BarRow } from "./charts";
import { InfoTip } from "./Explain";
import { t } from "./i18n";
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
    key: row.key, label: nameOf(row.key), title: t(`${nameOf(row.key)} · ${row.succeeded + row.failed} actions terminées`, `${nameOf(row.key)} · ${row.succeeded + row.failed} finished actions`), marker: colorOf(row.key),
    segments: [{ value: row.succeeded, color: colorOf(row.key), label: t("réussies", "succeeded") }, { value: row.failed, color: FAILURE, label: t("échecs", "failures"), pattern: true }],
    valueLabel: row.failed ? `${row.succeeded + row.failed} · ${t(`${Math.round((row.failed / (row.succeeded + row.failed)) * 100)} % d’échecs`, `${Math.round((row.failed / (row.succeeded + row.failed)) * 100)}% failed`)}` : String(row.succeeded)
  }));
  const toolRows: BarRow[] = data.tools.map((row) => ({
    key: row.name, label: row.name, title: t(`Outil ${row.name}`, `Tool ${row.name}`),
    segments: [{ value: row.calls, color: SINGLE_SERIES, label: t("lancements", "runs") }, { value: row.failed, color: FAILURE, label: t("échecs", "failures"), pattern: true }],
    valueLabel: row.failed ? `${row.calls} · ${row.failed} ✗` : String(row.calls)
  }));
  const fileRows: BarRow[] = data.files.map((row) => ({
    key: row.path, label: shortPath(row.path), title: row.path,
    segments: [{ value: row.writes, color: NEUTRAL_STRONG, label: t("modifications", "edits") }, { value: row.reads, color: NEUTRAL_SOFT, label: t("lectures", "reads") }],
    valueLabel: t(`${row.writes} modif. · ${row.reads} lus`, `${row.writes} edits · ${row.reads} reads`)
  }));
  const tokenRows: BarRow[] = data.agentTokens.map((row) => ({
    key: row.key, label: nameOf(row.key), title: t(`${nameOf(row.key)} · tokens fournis par l’agent`, `${nameOf(row.key)} · tokens reported by the agent`), marker: colorOf(row.key),
    segments: [{ value: row.input, color: colorOf(row.key), label: t("lus (contexte et cache)", "read (context and cache)") }, { value: row.output, color: colorOf(row.key), label: t("écrits", "written"), pattern: true }],
    valueLabel: `${formatCompact(row.input)} / ${formatCompact(row.output)}`
  }));
  const turnRows: BarRow[] = data.turns.map((row) => ({
    key: row.key, label: nameOf(row.key), title: t(`${nameOf(row.key)} · ${row.turns} tours mesurés · le plus long : ${formatDuration(row.longestMs)}`, `${nameOf(row.key)} · ${row.turns} measured turns · longest: ${formatDuration(row.longestMs)}`), marker: colorOf(row.key),
    segments: [{ value: row.averageMs, color: colorOf(row.key), label: t("durée moyenne", "average duration") }],
    valueLabel: t(`${formatDuration(row.averageMs)} · ${row.turns} tours`, `${formatDuration(row.averageMs)} · ${row.turns} turns`)
  }));
  const modelRows: BarRow[] = data.models.map((row) => ({
    key: row.model, label: row.model, title: t(`${row.model} · ${row.requests} requêtes`, `${row.model} · ${row.requests} requests`),
    segments: [{ value: row.tokens, color: SINGLE_SERIES, label: "tokens" }],
    valueLabel: t(`${formatCompact(row.tokens)} · ${row.requests} req.`, `${formatCompact(row.tokens)} · ${row.requests} req.`)
  }));

  const repositoryRows: BarRow[] = data.repositories.map((row) => ({
    key: row.path, label: row.name, title: t(`${row.name} · ${row.total} événements`, `${row.name} · ${row.total} events`),
    segments: CHART_KEYS.map((key) => ({ value: row.byAgent.get(key) ?? 0, color: colorOf(key), label: nameOf(key) })),
    valueLabel: String(row.total)
  }));
  const summary = [
    t(`${data.sessions} session${data.sessions > 1 ? "s" : ""}`, `${data.sessions} session${data.sessions === 1 ? "" : "s"}`),
    t(`${formatCompact(data.scoped.length)} événements`, `${formatCompact(data.scoped.length)} events`),
    t(`${formatCompact(data.toolCalls)} actions d’outils`, `${formatCompact(data.toolCalls)} tool actions`),
    data.failures ? t(`${data.failures} échec${data.failures > 1 ? "s" : ""}`, `${data.failures} failure${data.failures === 1 ? "" : "s"}`) : null,
    data.tokens ? `${formatCompact(data.tokens)} tokens` : null
  ].filter(Boolean).join(" · ");
  const empty = range === "all" ? t("Aucun événement pour l’instant.", "No events yet.") : t(`Rien sur ${rangeLabel(range)} — essaie « Tout ».`, `Nothing in the last ${rangeLabel(range)} — try “All”.`);

  const scope = dataset.truncated
    ? { tone: "warn", text: t(`Calculé sur les ${formatCompact(dataset.events.length)} événements les plus récents, sur ${formatCompact(dataset.total)} enregistrés pour cette période : choisis une période plus courte pour des totaux complets.`, `Computed on the ${formatCompact(dataset.events.length)} most recent events out of ${formatCompact(dataset.total)} stored for this period: pick a shorter period for complete totals.`) }
    : dataset.source === "loaded"
      ? { tone: "warn", text: t("Aperçu : calculé seulement sur les événements affichés, sans la base locale.", "Preview: computed on the displayed events only, without the local database.") }
      : { tone: "ok", text: t("Calculé sur tous les événements enregistrés pendant cette période.", "Computed on every event stored for this period.") };

  return <section className="page-section" aria-labelledby="analytics-title">
    <header className="section-header level-2">
      <div className="section-header-text">
        <h2 id="analytics-title">{t("Analyse", "Analytics")}<InfoTip label={t("Comment lire l’analyse ?", "How to read the analytics?")}>{t("Chaque graphique répond à une question sur la période choisie. Survole une courbe ou une barre pour voir les valeurs exactes. Les couleurs identifient toujours le même agent ; le rouge hachuré signale des échecs.", "Each chart answers one question about the chosen period. Hover a line or a bar to see exact values. Colours always identify the same agent; hatched red marks failures.")}</InfoTip></h2>
        <p>{summary || t("Aucune activité sur cette période.", "No activity in this period.")}</p>
        <p className={`data-scope tone-${scope.tone}`}>{scope.text}</p>
      </div>
      <div className="section-header-actions">
        <div className="segmented" role="group" aria-label={t("Période analysée", "Analysed period")}>{RANGES.map((key) => <button key={key} aria-pressed={key === range} onClick={() => onRange(key)}>{rangeLabel(key)}</button>)}</div>
      </div>
    </header>
    <Resizable id="analytics-lines" defaultHeight={300} min={180} max={1000} label={t("les courbes", "the line charts")}>
      <div className="chart-grid two">
        <ChartCard title={t("Quand mes agents travaillent-ils ?", "When do my agents work?")} explain={t("Nombre d’événements reçus (actions, messages, fins de tour) par tranche de temps, un trait par agent. Un pic = une période de travail intense.", "Events received (actions, messages, turn ends) per time slot, one line per agent. A peak means intense work.")}><LineChart series={lines(data.activity)} axis={data.axis} format={formatCompact} unit={t("événements", "events")} emptyText={empty} /></ChartCard>
        <ChartCard title={t("Combien de tokens consomment-ils ?", "How many tokens do they use?")} explain={t("Tokens traités par le modèle à chaque tranche (texte lu, y compris le cache, et texte écrit), tels que fournis par chaque agent. Les agents qui ne transmettent pas ce compteur n’apparaissent pas.", "Tokens processed by the model per time slot (text read, cache included, and text written), as reported by each agent. Agents that don’t report this counter don’t appear.")}><LineChart series={lines(data.tokenSeries)} axis={data.axis} format={formatCompact} unit="tokens" emptyText={t("Aucun compteur de tokens fourni sur cette période.", "No token counter reported in this period.")} /></ChartCard>
      </div>
    </Resizable>
    <Resizable id="analytics-bars" defaultHeight={560} min={220} max={1600} label={t("les graphiques en barres", "the bar charts")}>
      <div className="chart-grid three">
        <ChartCard title={t("Qui agit le plus, et qui échoue ?", "Who acts the most, and who fails?")} explain={t("Actions terminées par agent. La partie rouge hachurée correspond aux actions en échec ; un taux élevé peut signaler un agent bloqué.", "Finished actions per agent. The hatched red part is failed actions; a high rate may mean a stuck agent.")}><BarList rows={callRows} format={formatCompact} legend={[{ label: t("échecs", "failures"), color: FAILURE, pattern: true }]} emptyText={t("Aucune action terminée sur cette période.", "No finished action in this period.")} /></ChartCard>
        <ChartCard title={t("Quels outils servent le plus ?", "Which tools are used most?")} explain={t("Outils lancés par tous les agents (lecture, modification, commande…), avec leurs échecs en rouge hachuré.", "Tools run by all agents (read, edit, command…), with their failures in hatched red.")}><BarList rows={toolRows} format={formatCompact} emptyText={t("Aucun outil utilisé sur cette période.", "No tool used in this period.")} /></ChartCard>
        <ChartCard title={t("Quels fichiers sont les plus touchés ?", "Which files are touched most?")} explain={t("Fichiers sur lesquels les agents ont travaillé : en clair les modifications, en foncé les simples lectures. Survole un nom pour voir son chemin complet.", "Files the agents worked on: light for edits, dark for reads. Hover a name for its full path.")}><BarList rows={fileRows} format={formatCompact} legend={[{ label: t("modifiés", "edited"), color: NEUTRAL_STRONG }, { label: t("lus", "read"), color: NEUTRAL_SOFT }]} emptyText={t("Aucun fichier signalé sur cette période.", "No file reported in this period.")} /></ChartCard>
        <ChartCard title={t("Qui consomme le plus de tokens ?", "Who uses the most tokens?")} explain={t("Tokens par agent : partie pleine = texte lu par le modèle (contexte et cache), partie hachurée = texte écrit.", "Tokens per agent: solid part = text read by the model (context and cache), hatched part = text written.")}><BarList rows={tokenRows} format={formatCompact} emptyText={t("Aucun compteur de tokens fourni.", "No token counter reported.")} /></ChartCard>
        <ChartCard title={t("Combien de temps dure un tour ?", "How long does a turn take?")} explain={t("Durée moyenne d’un tour (de ton message jusqu’à la fin du travail de l’agent), quand l’agent la fournit. Survole une barre pour voir le tour le plus long.", "Average turn duration (from your message to the end of the agent’s work), when the agent reports it. Hover a bar for the longest turn.")}><BarList rows={turnRows} format={formatDuration} emptyText={t("Aucune durée de tour fournie sur cette période.", "No turn duration reported in this period.")} /></ChartCard>
        {repositoryOf && <ChartCard title={t("Sur quels dépôts ?", "On which repositories?")} explain={t("Événements par dépôt du workspace, découpés par agent (une couleur par agent).", "Events per workspace repository, split by agent (one colour per agent).")}><BarList rows={repositoryRows} format={formatCompact} emptyText={t("Aucun événement rattaché à un dépôt du workspace.", "No event attached to a workspace repository.")} /></ChartCard>}
        <ChartCard title={t("Quels modèles sont utilisés ?", "Which models are used?")} explain={t("Modèles d’IA rapportés par les agents, classés par tokens consommés, avec le nombre de requêtes.", "AI models reported by the agents, ranked by tokens used, with the number of requests.")}><BarList rows={modelRows} format={formatCompact} emptyText={t("Aucun modèle rapporté sur cette période.", "No model reported in this period.")} /></ChartCard>
      </div>
    </Resizable>
  </section>;
}

function ChartCard({ title, explain, children }: { title: string; explain: string; children: React.ReactNode }) {
  return <div className="chart-card"><h3>{title}<InfoTip label={t(`Explication : ${title}`, `About: ${title}`)}>{explain}</InfoTip></h3>{children}</div>;
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
