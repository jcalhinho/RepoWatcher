import { useMemo, useState } from "react";
import {
  RANGE_LABELS, bucketSeries, eventsInRange, formatCompact, formatDuration, modelsUsed, timeAxis, toolCallsByAgent,
  tokensByAgent, topFiles, topTools, totalTokens, turnDurations, type AnalyticsRange
} from "./analytics";
import { BarList, LineChart, type BarRow } from "./charts";
import { chartProviders, providers } from "./providers";
import { sessionKey, type SessionEvent } from "./types";
import { useNow } from "./useNow";

// Status and neutral colors: never reused for an agent identity.
const FAILURE = "#d03b3b";
const NEUTRAL_STRONG = "#c3cad8";
const NEUTRAL_SOFT = "#5f6a7f";
const SINGLE_SERIES = "#7d8aa3";

const CHART_KEYS = chartProviders.map((provider) => provider.eventKey);
const byKey = new Map(providers.map((provider) => [provider.eventKey, provider]));
const nameOf = (key: string) => byKey.get(key)?.name ?? key;
const colorOf = (key: string) => byKey.get(key)?.color ?? SINGLE_SERIES;
const shortPath = (path: string) => path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");

export function SessionAnalytics({ events }: { events: SessionEvent[] }) {
  const now = useNow(10_000);
  const [chosen, setChosen] = useState<AnalyticsRange | null>(null);
  // Until the user picks a window, show the last hour when it has activity, otherwise all loaded history.
  const hasRecent = events.some((event) => now - Date.parse(event.occurred_at) < 60 * 60_000);
  const range: AnalyticsRange = chosen ?? (hasRecent || !events.length ? "1h" : "all");

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
      models: modelsUsed(scoped)
    };
  }, [events, range, now]);

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

  const summary = [
    `${data.sessions} session${data.sessions > 1 ? "s" : ""}`,
    `${formatCompact(data.scoped.length)} événements`,
    `${formatCompact(data.toolCalls)} appels d’outils`,
    data.failures ? `${data.failures} échec${data.failures > 1 ? "s" : ""}` : null,
    data.tokens ? `${formatCompact(data.tokens)} tokens` : null
  ].filter(Boolean).join(" · ");
  const empty = range === "all" ? "Aucun événement chargé pour l’instant." : `Rien sur ${RANGE_LABELS[range]} — essaie « Tout ».`;

  return <section className="analytics-panel" aria-labelledby="analytics-title">
    <div className="analytics-heading">
      <div><h2 id="analytics-title">Analyse des sessions</h2><p>{summary}</p></div>
      <div className="range-filter" role="group" aria-label="Période analysée">{(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((key) => <button key={key} className={key === range ? "selected" : ""} aria-pressed={key === range} onClick={() => setChosen(key)}>{RANGE_LABELS[key]}</button>)}</div>
    </div>
    <div className="analytics-lines">
      <ChartCard title="Activité des agents" note="événements reçus par tranche, par agent"><LineChart series={lines(data.activity)} axis={data.axis} format={formatCompact} unit="événements" emptyText={empty} /></ChartCard>
      <ChartCard title="Tokens consommés" note="entrée + sortie, valeurs fournies par les connecteurs"><LineChart series={lines(data.tokenSeries)} axis={data.axis} format={formatCompact} unit="tokens" emptyText="Aucun compteur de tokens fourni sur cette période." /></ChartCard>
    </div>
    <div className="analytics-bars">
      <ChartCard title="Appels d’outils par agent" note="terminés, dont échecs"><BarList rows={callRows} format={formatCompact} legend={[{ label: "échecs (hachuré)", color: FAILURE, pattern: true }]} emptyText="Aucun appel d’outil terminé." /></ChartCard>
      <ChartCard title="Outils les plus utilisés" note="appels lancés, échecs hachurés"><BarList rows={toolRows} format={formatCompact} emptyText="Aucun outil utilisé." /></ChartCard>
      <ChartCard title="Fichiers les plus touchés" note="modifications et lectures"><BarList rows={fileRows} format={formatCompact} legend={[{ label: "modifiés", color: NEUTRAL_STRONG }, { label: "lus", color: NEUTRAL_SOFT }]} emptyText="Aucun chemin de fichier remonté." /></ChartCard>
      <ChartCard title="Tokens par agent" note="entrée / sortie (hachuré)"><BarList rows={tokenRows} format={formatCompact} emptyText="Aucun compteur de tokens fourni." /></ChartCard>
      <ChartCard title="Durée des tours" note="moyenne des durées rapportées"><BarList rows={turnRows} format={formatDuration} emptyText="Aucune durée de tour rapportée." /></ChartCard>
      <ChartCard title="Modèles utilisés" note="tokens et requêtes par modèle"><BarList rows={modelRows} format={formatCompact} emptyText="Aucun modèle rapporté." /></ChartCard>
    </div>
  </section>;
}

function ChartCard({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return <div className="chart-card"><div className="chart-card-heading"><h3>{title}</h3><small>{note}</small></div>{children}</div>;
}
