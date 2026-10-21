import { findModelPrice, type ModelPrice, MODEL_PRICES } from "./pricing";
import { providerById } from "./providers";

const CODEX = providerById("codex").eventKey;
const CURSOR = providerById("cursor").eventKey;
const GEMINI = providerById("gemini").eventKey;

export type SourcedValue<T> = { value: T; origin: string };

export type SummaryEvent = {
  event_id: string;
  session_id: string;
  occurred_at: string;
  provider: string;
  kind: string;
  project_path?: string | null;
  project_hash?: string | null;
  tool_name?: string | null;
  file_path?: string | null;
  model?: SourcedValue<string> | null;
  input_tokens?: SourcedValue<number> | null;
  output_tokens?: SourcedValue<number> | null;
  duration_ms?: SourcedValue<number> | null;
  outcome?: string | null;
};

/** Which observed signal a turn count is based on; differs per connector. */
export type TurnBasis = "codex_turn_started" | "cursor_stop" | "user_message";

export type ToolUsage = { name: string | null; count: number; failed: number };
export type FileTouch = { path: string; events: number; changed: boolean; tools: string[] };
export type ModelSeen = { name: string; origins: string[]; events: number };

export type TokenTotals = {
  input: number | null;
  output: number | null;
  origins: string[];
  usageEvents: number;
};

export type CostEstimate = {
  value: number;
  currency: "USD";
  origin: "estimated";
  pricedEvents: number;
  unpricedEvents: number;
  unpricedInputTokens: number;
  unpricedOutputTokens: number;
  unpricedModels: string[];
  prices: Array<Pick<ModelPrice, "label" | "inputPerMTok" | "outputPerMTok" | "checkedOn" | "source">>;
};

export type SessionSummary = {
  provider: string;
  sessionId: string;
  projectPath: string | null;
  eventCount: number;
  startedAt: string;
  endedAt: string;
  /** Wall-clock span between the first and last observed event. */
  duration: SourcedValue<number> & { origin: "derived" };
  /** Session duration as reported by the connector itself (Cursor `sessionEnd`). */
  reportedDuration: SourcedValue<number> | null;
  turns: { count: number; basis: TurnBasis };
  tools: ToolUsage[];
  failures: { count: number; tools: string[] };
  files: FileTouch[];
  tokens: TokenTotals | null;
  models: ModelSeen[];
  cost: CostEstimate | null;
};

export function summarizeSession(events: SummaryEvent[], prices: ModelPrice[] = MODEL_PRICES): SessionSummary | null {
  if (!events.length) return null;
  const ordered = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const projectPath = ordered.find((event) => event.project_path)?.project_path ?? null;
  const reported = [...ordered].reverse().find((event) => event.kind === "session_ended" && event.duration_ms)?.duration_ms ?? null;

  return {
    provider: first.provider,
    sessionId: first.session_id,
    projectPath,
    eventCount: ordered.length,
    startedAt: first.occurred_at,
    endedAt: last.occurred_at,
    duration: { value: Math.max(0, Date.parse(last.occurred_at) - Date.parse(first.occurred_at)), origin: "derived" },
    reportedDuration: reported ? { value: reported.value, origin: reported.origin } : null,
    turns: countTurns(first.provider, ordered),
    tools: countTools(ordered),
    failures: countFailures(ordered),
    files: collectFiles(ordered, projectPath),
    tokens: sumTokens(ordered),
    models: collectModels(ordered),
    cost: estimateCost(ordered, prices)
  };
}

function countTurns(provider: string, events: SummaryEvent[]): SessionSummary["turns"] {
  if (provider === CODEX) {
    // Codex marks every `task_started` with `turn-started:<id>`; its user
    // messages can also include injected context, so they are not counted.
    const turns = new Set(events.filter((event) => event.outcome?.startsWith("turn-started:")).map((event) => event.outcome));
    return { count: turns.size, basis: "codex_turn_started" };
  }
  if (provider === CURSOR) {
    // Cursor hooks expose no prompt event; `stop` closes each agent loop.
    return { count: events.filter((event) => event.kind === "checkpoint").length, basis: "cursor_stop" };
  }
  return { count: events.filter((event) => event.kind === "user_message").length, basis: "user_message" };
}

function countTools(events: SummaryEvent[]): ToolUsage[] {
  const byName = new Map<string | null, { started: number; ended: number; failed: number }>();
  for (const event of events) {
    if (event.kind !== "tool_started" && event.kind !== "tool_finished" && event.kind !== "tool_failed") continue;
    const name = event.tool_name || null;
    const entry = byName.get(name) ?? { started: 0, ended: 0, failed: 0 };
    if (event.kind === "tool_started") entry.started += 1;
    else entry.ended += 1;
    if (event.kind === "tool_failed") entry.failed += 1;
    byName.set(name, entry);
  }
  // Some connectors emit a start and an end per call, others only the end:
  // the larger side is the number of calls observed, never their sum.
  return [...byName.entries()]
    .map(([name, entry]) => ({ name, count: Math.max(entry.started, entry.ended), failed: entry.failed }))
    .sort((a, b) => b.count - a.count || (a.name ?? "").localeCompare(b.name ?? ""));
}

function countFailures(events: SummaryEvent[]): SessionSummary["failures"] {
  const failed = events.filter((event) => event.kind === "tool_failed" || event.outcome === "failed");
  const tools = [...new Set(failed.map((event) => event.tool_name).filter((name): name is string => Boolean(name)))].sort();
  return { count: failed.length, tools };
}

function collectFiles(events: SummaryEvent[], projectPath: string | null): FileTouch[] {
  const root = projectPath ? normalizePath(projectPath) : null;
  const files = new Map<string, FileTouch>();
  for (const event of events) {
    if (!event.file_path) continue;
    let path = normalizePath(event.file_path);
    if (root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1);
    const entry = files.get(path) ?? { path, events: 0, changed: false, tools: [] };
    entry.events += 1;
    if (event.kind === "file_changed") entry.changed = true;
    if (event.tool_name && !entry.tools.includes(event.tool_name)) entry.tools.push(event.tool_name);
    files.set(path, entry);
  }
  return [...files.values()].sort((a, b) => b.events - a.events || a.path.localeCompare(b.path));
}

function sumTokens(events: SummaryEvent[]): TokenTotals | null {
  let input: number | null = null;
  let output: number | null = null;
  let usageEvents = 0;
  const origins = new Set<string>();
  for (const event of events) {
    if (!event.input_tokens && !event.output_tokens) continue;
    usageEvents += 1;
    if (event.input_tokens) {
      input = (input ?? 0) + event.input_tokens.value;
      origins.add(event.input_tokens.origin);
    }
    if (event.output_tokens) {
      output = (output ?? 0) + event.output_tokens.value;
      origins.add(event.output_tokens.origin);
    }
  }
  return usageEvents ? { input, output, origins: [...origins].sort(), usageEvents } : null;
}

function collectModels(events: SummaryEvent[]): ModelSeen[] {
  const models = new Map<string, { origins: Set<string>; events: number }>();
  for (const event of events) {
    if (!event.model?.value) continue;
    const entry = models.get(event.model.value) ?? { origins: new Set<string>(), events: 0 };
    entry.origins.add(event.model.origin);
    entry.events += 1;
    models.set(event.model.value, entry);
  }
  return [...models.entries()]
    .map(([name, entry]) => ({ name, origins: [...entry.origins].sort(), events: entry.events }))
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
}

/**
 * Prices each usage event with its own model. An event is priced only when its
 * model is in the table and it carries both input and output counts; anything
 * else is reported as unpriced instead of being guessed. Returns null when no
 * event could be priced at all.
 */
export function estimateCost(events: SummaryEvent[], prices: ModelPrice[] = MODEL_PRICES): CostEstimate | null {
  let value = 0;
  let pricedEvents = 0;
  let unpricedEvents = 0;
  let unpricedInputTokens = 0;
  let unpricedOutputTokens = 0;
  const unpricedModels = new Set<string>();
  const used = new Map<string, ModelPrice>();
  for (const event of events) {
    if (!event.input_tokens && !event.output_tokens) continue;
    const price = event.model?.value ? findModelPrice(event.model.value, prices) : null;
    const input = event.input_tokens?.value;
    const output = event.output_tokens?.value;
    const withinBaseRate = price?.baseRateMaxInputTokens === undefined || (input ?? 0) <= price.baseRateMaxInputTokens;
    if (!price || input === undefined || output === undefined || !withinBaseRate) {
      unpricedEvents += 1;
      unpricedInputTokens += input ?? 0;
      unpricedOutputTokens += output ?? 0;
      unpricedModels.add(event.model?.value || "modèle non fourni");
      continue;
    }
    value += (input * price.inputPerMTok + output * price.outputPerMTok) / 1_000_000;
    pricedEvents += 1;
    used.set(price.label, price);
  }
  if (!pricedEvents) return null;
  return {
    value,
    currency: "USD",
    origin: "estimated",
    pricedEvents,
    unpricedEvents,
    unpricedInputTokens,
    unpricedOutputTokens,
    unpricedModels: [...unpricedModels].sort(),
    prices: [...used.values()].map(({ label, inputPerMTok, outputPerMTok, checkedOn, source }) => ({ label, inputPerMTok, outputPerMTok, checkedOn, source }))
  };
}

/**
 * The event list is paged newest first. When older pages remain and this
 * session reaches back to the oldest loaded event, its beginning may be
 * missing and every count is a lower bound.
 */
export function isPossiblyTruncated(sessionEvents: SummaryEvent[], loadedEvents: SummaryEvent[], hasMore: boolean) {
  if (!hasMore || !sessionEvents.length || !loadedEvents.length) return false;
  const oldestLoaded = loadedEvents.reduce((oldest, event) => (event.occurred_at < oldest ? event.occurred_at : oldest), loadedEvents[0].occurred_at);
  return sessionEvents.some((event) => event.occurred_at <= oldestLoaded);
}

/** Same rule as the repository map: explicit project path, or Gemini's project hash. */
export function sessionMatchesRepository(events: SummaryEvent[], root: string, projectHash: string) {
  const normalizedRoot = normalizePath(root).toLowerCase();
  // An agent started in a subfolder still works inside the repository.
  return events.some((event) =>
    (event.project_path && (normalizePath(event.project_path).toLowerCase() === normalizedRoot || normalizePath(event.project_path).toLowerCase().startsWith(`${normalizedRoot}/`))) ||
    (event.provider === GEMINI && event.project_hash === projectHash)
  );
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/$/, "");
}
