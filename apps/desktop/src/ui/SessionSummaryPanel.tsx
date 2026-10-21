import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPossiblyTruncated, sessionMatchesRepository, summarizeSession, type SummaryEvent, type TurnBasis } from "./sessionSummary";

type WindowCommits = {
  commits: Array<{ id: string; short_id: string; subject: string; author: string; committed_at: string }>;
  truncated: boolean;
};

const originLabels: Record<string, string> = {
  provider: "fournisseur",
  local_observation: "observation locale",
  derived: "dérivé",
  estimated: "estimé"
};

const turnBasisLabels: Record<TurnBasis, string> = {
  user_message: "prompts utilisateur reçus",
  codex_turn_started: "tours Codex démarrés",
  cursor_stop: "arrêts d’agent Cursor (stop)"
};

export function SessionSummaryPanel({ events, loadedEvents, hasMore, repository }: {
  events: SummaryEvent[];
  loadedEvents: SummaryEvent[];
  hasMore: boolean;
  repository: { root: string; project_hash: string } | null;
}) {
  const summary = useMemo(() => summarizeSession(events), [events]);
  const truncated = useMemo(() => isPossiblyTruncated(events, loadedEvents, hasMore), [events, loadedEvents, hasMore]);
  const inRepository = useMemo(() => Boolean(repository && sessionMatchesRepository(events, repository.root, repository.project_hash)), [events, repository]);
  if (!summary) return null;
  const toolCalls = summary.tools.reduce((sum, tool) => sum + tool.count, 0);

  return <section className="session-summary" aria-label="Résumé de la session">
    <div className="session-summary-heading"><h3>Résumé de session</h3><span className="count-badge">{summary.eventCount} événements</span></div>
    {truncated && <p className="summary-warning">Le début de cette session n’est peut-être pas chargé : les valeurs ci-dessous sont des minimums. Charge les événements plus anciens pour compléter.</p>}
    <div className="summary-grid">
      <SummaryStat label="Durée observée" value={formatDuration(summary.duration.value)} origin={summary.duration.origin} note={`${formatTime(summary.startedAt)} → ${formatTime(summary.endedAt)}`} />
      {summary.reportedDuration && <SummaryStat label="Durée déclarée" value={formatDuration(summary.reportedDuration.value)} origin={summary.reportedDuration.origin} note="Fournie à la fin de session" />}
      <SummaryStat label="Tours" value={String(summary.turns.count)} origin="derived" note={turnBasisLabels[summary.turns.basis]} />
      <SummaryStat label="Appels d’outils" value={String(toolCalls)} origin="derived" note={`${summary.tools.length} outil${summary.tools.length > 1 ? "s" : ""} distinct${summary.tools.length > 1 ? "s" : ""}`} />
      <SummaryStat label="Échecs" value={String(summary.failures.count)} origin="derived" note={summary.failures.tools.length ? summary.failures.tools.join(", ") : "Aucun échec remonté"} tone={summary.failures.count ? "failed" : undefined} />
      <SummaryStat label="Tokens input / output" value={summary.tokens ? `${formatOptional(summary.tokens.input)} / ${formatOptional(summary.tokens.output)}` : "Non fournis"} origin={summary.tokens ? summary.tokens.origins : null} note={summary.tokens ? `Somme de ${summary.tokens.usageEvents} relevé${summary.tokens.usageEvents > 1 ? "s" : ""}${summary.tokens.cacheRead || summary.tokens.cacheWrite ? ` · cache : ${formatOptional(summary.tokens.cacheRead)} lus, ${formatOptional(summary.tokens.cacheWrite)} écrits` : ""}` : "Aucun compteur exposé par le connecteur"} />
      {summary.cost
        ? <SummaryStat label="Coût estimé" value={formatUsd(summary.cost.value)} origin={summary.cost.origin} note={summary.cost.unpricedEvents ? `Partiel : ${summary.cost.unpricedEvents} relevé${summary.cost.unpricedEvents > 1 ? "s" : ""} sans tarif` : "Prix publics, cache inclus quand il est fourni"} />
        : <SummaryStat label="Coût estimé" value="Non estimé" origin={null} note={summary.tokens ? "Modèle absent de la table de prix" : "Pas de tokens à valoriser"} />}
    </div>

    <div className="summary-columns">
      <div>
        <h4>Modèles</h4>
        {summary.models.length ? <ul className="summary-list">{summary.models.map((model) => <li key={model.name}><code>{model.name}</code><span>{model.events} év.</span><OriginTags origins={model.origins} /></li>)}</ul> : <p className="summary-empty">Aucun modèle fourni par le connecteur.</p>}
        <h4>Outils utilisés</h4>
        {summary.tools.length ? <ul className="summary-list">{summary.tools.map((tool) => <li key={tool.name ?? ""}><code>{tool.name ?? "outil sans nom"}</code><span>{tool.count}×{tool.failed ? <b className="summary-failed"> · {tool.failed} échec{tool.failed > 1 ? "s" : ""}</b> : null}</span></li>)}</ul> : <p className="summary-empty">Aucun événement d’outil.</p>}
      </div>
      <div>
        <h4>Fichiers touchés <small>{summary.files.length}</small></h4>
        {summary.files.length ? <ul className="summary-list">{summary.files.slice(0, 40).map((file) => <li key={file.path}><code title={file.path}>{file.path}</code><span>{file.changed ? "modifié · " : ""}{file.events} év.{file.tools.length ? ` · ${file.tools.join(", ")}` : ""}</span></li>)}</ul> : <p className="summary-empty">Aucun chemin de fichier remonté.</p>}
        {summary.files.length > 40 && <p className="summary-empty">… et {summary.files.length - 40} autres.</p>}
      </div>
    </div>

    {summary.cost && <details className="summary-pricing"><summary>Détail de l’estimation</summary><p>Chaque relevé est valorisé avec son propre modèle, au tarif public standard ; les tokens de cache fournis séparément sont valorisés au tarif de cache publié. Lots et tarifs négociés ne sont pas pris en compte ; ce n’est pas une facture.</p><ul>{summary.cost.prices.map((price) => <li key={price.label}>{price.label} : {price.inputPerMTok} $ / {price.outputPerMTok} $ par million de tokens input / output — relevé le {price.checkedOn} (<a href={price.source} target="_blank" rel="noreferrer">source</a>)</li>)}</ul>{summary.cost.unpricedEvents > 0 && <p>Non valorisés : {formatOptional(summary.cost.unpricedInputTokens)} input / {formatOptional(summary.cost.unpricedOutputTokens)} output ({summary.cost.unpricedModels.join(", ")}).</p>}</details>}

    {repository && <WindowCommitList repository={repository} since={summary.startedAt} until={summary.endedAt} inRepository={inRepository} />}
  </section>;
}

function WindowCommitList({ repository, since, until, inRepository }: { repository: { root: string }; since: string; until: string; inRepository: boolean }) {
  const [result, setResult] = useState<WindowCommits | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!inRepository) return;
    let active = true;
    setResult(null);
    setError("");
    invoke<WindowCommits>("commits_in_window", { path: repository.root, since, until })
      .then((value) => { if (active) setResult(value); })
      .catch((reason) => { if (active) setError(typeof reason === "string" ? reason : "Historique Git indisponible dans l’aperçu web."); });
    return () => { active = false; };
  }, [repository.root, since, until, inRepository]);

  return <div className="summary-commits">
    <h4>Commits dans la fenêtre de la session</h4>
    {!inRepository ? <p className="summary-empty">Cette session ne déclare pas le dépôt sélectionné ; aucun commit n’est rapproché.</p>
      : error ? <p className="summary-empty">{error}</p>
      : !result ? <p className="summary-empty">Lecture de l’historique Git…</p>
      : result.commits.length ? <ul className="summary-list">{result.commits.map((commit) => <li key={commit.id}><code>{commit.short_id}</code><span className="summary-commit-subject">{commit.subject}</span><span>{commit.author} · {formatTime(commit.committed_at)}</span></li>)}</ul>
      : <p className="summary-empty">Aucun commit daté entre {formatTime(since)} et {formatTime(until)}.</p>}
    {result?.truncated && <p className="summary-empty">Liste limitée aux 100 commits les plus récents de la fenêtre.</p>}
    <small>Date de commit comprise entre le premier et le dernier événement, toutes branches confondues. Coïncidence temporelle uniquement : ces commits ne sont pas attribués à l’agent.</small>
  </div>;
}

function SummaryStat({ label, value, origin, note, tone }: { label: string; value: string; origin: string | string[] | null; note: string; tone?: string }) {
  return <div className={`summary-stat ${tone ?? ""}`}>
    <div className="summary-stat-label">{label}{origin && <OriginTags origins={Array.isArray(origin) ? origin : [origin]} />}</div>
    <b>{value}</b>
    <small>{note}</small>
  </div>;
}

function OriginTags({ origins }: { origins: string[] }) {
  return <>{origins.map((origin) => <span key={origin} className={`origin-tag origin-${origin}`} title={originTitle(origin)}>{originLabels[origin] ?? origin}</span>)}</>;
}

function originTitle(origin: string) {
  if (origin === "provider") return "Valeur exposée telle quelle par le connecteur";
  if (origin === "estimated") return "Estimation locale, pas une valeur facturée";
  if (origin === "derived") return "Calculée localement à partir des événements observés";
  return "Observée localement";
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes) return `${minutes} min ${String(rest).padStart(2, "0")} s`;
  return `${rest} s`;
}

function formatTime(iso: string) { return new Date(iso).toLocaleString("fr-FR"); }
function formatOptional(value: number | null) { return value === null ? "—" : new Intl.NumberFormat("fr-FR").format(value); }
function formatUsd(value: number) {
  return `≈ ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value)}`;
}
