import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPossiblyTruncated, sessionMatchesRepository, summarizeSession, type SummaryEvent, type TurnBasis } from "./sessionSummary";
import { formatDuration } from "./analytics";
import { InfoTip } from "./Explain";
import { locale, t } from "./i18n";

type WindowCommits = {
  commits: Array<{ id: string; short_id: string; subject: string; author: string; committed_at: string }>;
  truncated: boolean;
};

function originLabel(origin: string) {
  switch (origin) {
    case "provider": return t("fourni", "reported");
    case "local_observation": return t("observé", "observed");
    case "derived": return t("calculé", "computed");
    case "estimated": return t("estimé", "estimated");
    default: return origin;
  }
}

function turnBasisLabel(basis: TurnBasis) {
  switch (basis) {
    case "user_message": return t("prompts utilisateur reçus", "user prompts received");
    case "codex_turn_started": return t("tours Codex démarrés", "Codex turns started");
    case "cursor_stop": return t("arrêts d’agent Cursor (stop)", "Cursor agent stops");
  }
}

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

  return <section className="session-summary" aria-label={t("Résumé de la session", "Session summary")}>
    <div className="session-summary-heading"><h3>{t("Résumé de la session", "Session summary")}<InfoTip label={t("Comment lire ce résumé ?", "How to read this summary?")}>{t("Chaque chiffre porte une étiquette : « fourni » vient directement de l’agent, « calculé » est déduit par l’app à partir des événements, « estimé » est une approximation (le coût). Rien n’est inventé : une valeur absente est affichée comme telle.", "Each number carries a label: “reported” comes straight from the agent, “computed” is derived by the app from events, “estimated” is an approximation (the cost). Nothing is made up: a missing value is shown as missing.")}</InfoTip></h3><span className="count-badge">{t(`${summary.eventCount} événements`, `${summary.eventCount} events`)}</span></div>
    {truncated && <p className="summary-warning">{t("Le début de cette session n’est peut-être pas chargé : les valeurs ci-dessous sont des minimums. Charge les événements plus anciens pour compléter.", "The start of this session may not be loaded: the values below are minimums. Load older events to complete them.")}</p>}
    <div className="summary-grid">
      <SummaryStat label={t("Durée observée", "Observed duration")} value={formatDuration(summary.duration.value)} origin={summary.duration.origin} note={`${formatTime(summary.startedAt)} → ${formatTime(summary.endedAt)}`} />
      {summary.reportedDuration && <SummaryStat label={t("Durée déclarée", "Reported duration")} value={formatDuration(summary.reportedDuration.value)} origin={summary.reportedDuration.origin} note={t("Fournie à la fin de session", "Reported at the end of the session")} />}
      <SummaryStat label={t("Tours", "Turns")} value={String(summary.turns.count)} origin="derived" note={turnBasisLabel(summary.turns.basis)} />
      <SummaryStat label={t("Appels d’outils", "Tool calls")} value={String(toolCalls)} origin="derived" note={t(`${summary.tools.length} outil${summary.tools.length > 1 ? "s" : ""} distinct${summary.tools.length > 1 ? "s" : ""}`, `${summary.tools.length} distinct tool${summary.tools.length === 1 ? "" : "s"}`)} />
      <SummaryStat label={t("Échecs", "Failures")} value={String(summary.failures.count)} origin="derived" note={summary.failures.tools.length ? summary.failures.tools.join(", ") : t("Aucun échec remonté", "No failure reported")} tone={summary.failures.count ? "failed" : undefined} />
      <SummaryStat label={t("Tokens lus / écrits", "Tokens read / written")} value={summary.tokens ? `${formatOptional(summary.tokens.input)} / ${formatOptional(summary.tokens.output)}` : t("Non fournis", "Not reported")} origin={summary.tokens ? summary.tokens.origins : null} note={summary.tokens ? t(`Somme de ${summary.tokens.usageEvents} relevé${summary.tokens.usageEvents > 1 ? "s" : ""}`, `Sum of ${summary.tokens.usageEvents} report${summary.tokens.usageEvents === 1 ? "" : "s"}`) + (summary.tokens.cacheRead || summary.tokens.cacheWrite ? t(` · dont cache : ${formatOptional(summary.tokens.cacheRead)} relus, ${formatOptional(summary.tokens.cacheWrite)} mis en cache`, ` · cache: ${formatOptional(summary.tokens.cacheRead)} read, ${formatOptional(summary.tokens.cacheWrite)} written`) : "") : t("Aucun compteur exposé par le connecteur", "No counter exposed by the connector")} />
      {summary.cost
        ? <SummaryStat label={t("Coût estimé", "Estimated cost")} value={formatUsd(summary.cost.value)} origin={summary.cost.origin} note={summary.cost.unpricedEvents ? t(`Partiel : ${summary.cost.unpricedEvents} relevé${summary.cost.unpricedEvents > 1 ? "s" : ""} sans tarif`, `Partial: ${summary.cost.unpricedEvents} report${summary.cost.unpricedEvents === 1 ? "" : "s"} without a price`) : t("Prix publics, cache inclus quand il est fourni", "Public prices, cache included when reported")} />
        : <SummaryStat label={t("Coût estimé", "Estimated cost")} value={t("Non estimé", "Not estimated")} origin={null} note={summary.tokens ? t("Modèle absent de la table de prix", "Model missing from the price table") : t("Pas de tokens à valoriser", "No tokens to price")} />}
    </div>

    <div className="summary-columns">
      <div>
        <h4>{t("Modèles", "Models")}</h4>
        {summary.models.length ? <ul className="summary-list">{summary.models.map((model) => <li key={model.name}><code>{model.name}</code><span>{model.events} {t("év.", "ev.")}</span><OriginTags origins={model.origins} /></li>)}</ul> : <p className="summary-empty">{t("Aucun modèle fourni par le connecteur.", "No model reported by the connector.")}</p>}
        <h4>{t("Outils utilisés", "Tools used")}</h4>
        {summary.tools.length ? <ul className="summary-list">{summary.tools.map((tool) => <li key={tool.name ?? ""}><code>{tool.name ?? t("outil sans nom", "unnamed tool")}</code><span>{tool.count}×{tool.failed ? <b className="summary-failed"> · {t(`${tool.failed} échec${tool.failed > 1 ? "s" : ""}`, `${tool.failed} failed`)}</b> : null}</span></li>)}</ul> : <p className="summary-empty">{t("Aucun événement d’outil.", "No tool event.")}</p>}
      </div>
      <div>
        <h4>{t("Fichiers touchés", "Files touched")} <small>{summary.files.length}</small></h4>
        {summary.files.length ? <ul className="summary-list">{summary.files.slice(0, 40).map((file) => <li key={file.path}><code title={file.path}>{file.path}</code><span>{file.changed ? t("modifié · ", "edited · ") : ""}{file.events} {t("év.", "ev.")}{file.tools.length ? ` · ${file.tools.join(", ")}` : ""}</span></li>)}</ul> : <p className="summary-empty">{t("Aucun chemin de fichier remonté.", "No file path reported.")}</p>}
        {summary.files.length > 40 && <p className="summary-empty">{t(`… et ${summary.files.length - 40} autres.`, `… and ${summary.files.length - 40} more.`)}</p>}
      </div>
    </div>

    {summary.cost && <details className="summary-pricing"><summary>{t("Détail de l’estimation", "Estimate details")}</summary><p>{t("Chaque relevé est valorisé avec son propre modèle, au tarif public standard ; les tokens de cache fournis séparément sont valorisés au tarif de cache publié. Lots et tarifs négociés ne sont pas pris en compte ; ce n’est pas une facture.", "Each report is priced with its own model at the standard public rate; cache tokens reported apart are priced at the published cache rate. Batch and negotiated rates are not taken into account; this is not an invoice.")}</p><ul>{summary.cost.prices.map((price) => <li key={price.label}>{price.label} : {price.inputPerMTok} $ / {price.outputPerMTok} $ {t("par million de tokens input / output — relevé le", "per million input / output tokens — checked on")} {price.checkedOn} (<a href={price.source} target="_blank" rel="noreferrer">source</a>)</li>)}</ul>{summary.cost.unpricedEvents > 0 && <p>{t("Non valorisés", "Not priced")} : {formatOptional(summary.cost.unpricedInputTokens)} input / {formatOptional(summary.cost.unpricedOutputTokens)} output ({summary.cost.unpricedModels.join(", ")}).</p>}</details>}

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
      .catch((reason) => { if (active) setError(typeof reason === "string" ? reason : t("Historique Git indisponible dans l’aperçu web.", "Git history unavailable in the web preview.")); });
    return () => { active = false; };
  }, [repository.root, since, until, inRepository]);

  return <div className="summary-commits">
    <h4>{t("Commits dans la fenêtre de la session", "Commits during the session")}</h4>
    {!inRepository ? <p className="summary-empty">{t("Cette session ne déclare pas le dépôt sélectionné ; aucun commit n’est rapproché.", "This session doesn’t declare the selected repository; no commit is matched.")}</p>
      : error ? <p className="summary-empty">{error}</p>
      : !result ? <p className="summary-empty">{t("Lecture de l’historique Git…", "Reading Git history…")}</p>
      : result.commits.length ? <ul className="summary-list">{result.commits.map((commit) => <li key={commit.id}><code>{commit.short_id}</code><span className="summary-commit-subject">{commit.subject}</span><span>{commit.author} · {formatTime(commit.committed_at)}</span></li>)}</ul>
      : <p className="summary-empty">{t(`Aucun commit daté entre ${formatTime(since)} et ${formatTime(until)}.`, `No commit dated between ${formatTime(since)} and ${formatTime(until)}.`)}</p>}
    {result?.truncated && <p className="summary-empty">{t("Liste limitée aux 100 commits les plus récents de la fenêtre.", "List limited to the 100 most recent commits of the window.")}</p>}
    <small>{t("Date de commit comprise entre le premier et le dernier événement, toutes branches confondues. Coïncidence temporelle uniquement : ces commits ne sont pas attribués à l’agent.", "Commit date between the first and last event, all branches. Time coincidence only: these commits are not attributed to the agent.")}</small>
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
  return <>{origins.map((origin) => <span key={origin} className={`origin-tag origin-${origin}`} title={originTitle(origin)}>{originLabel(origin)}</span>)}</>;
}

function originTitle(origin: string) {
  if (origin === "provider") return t("Valeur exposée telle quelle par le connecteur", "Value exposed as-is by the connector");
  if (origin === "estimated") return t("Estimation locale, pas une valeur facturée", "Local estimate, not a billed amount");
  if (origin === "derived") return t("Calculée localement à partir des événements observés", "Computed locally from observed events");
  return t("Observée localement", "Observed locally");
}


function formatTime(iso: string) { return new Date(iso).toLocaleString(locale()); }
function formatOptional(value: number | null) { return value === null ? "—" : new Intl.NumberFormat(locale()).format(value); }
function formatUsd(value: number) {
  return `≈ ${new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value)}`;
}
