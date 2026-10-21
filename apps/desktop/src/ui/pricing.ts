// Public list prices used for the *estimated* session cost ("au tarif API").
//
// Maintenance rules:
// - Add a model only with a price read from the provider's published pricing
//   page, and record that page and the date it was read in `source`/`checkedOn`.
// - Never add a guessed or "probably the same as" price: a model missing from
//   this table simply has no estimated cost in the UI. The same goes for a
//   tier or a cache rate the page does not give: leave it out and the
//   requests that need it stay unpriced.
// - Prices are USD per million tokens, standard (non-batch, non-priority)
//   tier, text input.
// - A model id is priced at its own vendor's API (DeepSeek models at
//   DeepSeek's, Qwen models at Alibaba Cloud's…). An agent that reaches the
//   model through another host (OpenRouter, a cloud marketplace, a
//   subscription) is billed differently: the estimate says what the same
//   tokens would cost on the vendor's API.
// - Cache prices apply only to tokens a connector reports apart as cache
//   reads or writes; connectors report uncached input in `input_tokens`.

export type PriceTier = {
  /**
   * Highest prompt size (uncached input + cache reads + cache writes of one
   * request) this tier applies to; absent on an open-ended last tier. Vendors
   * price the whole request at the tier its prompt size falls in.
   */
  upToPromptTokens?: number;
  inputPerMTok: number;
  outputPerMTok: number;
  /** Price of prompt tokens read from / written to the provider cache; absent when unknown. */
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
};

/** Discount applied outside peak hours (DeepSeek). Public holidays are not modelled: they count as peak. */
export type OffPeakRule = {
  multiplier: number;
  /** Peak windows as [start, end) UTC hours, Monday to Friday. */
  peakHoursUtc: Array<[number, number]>;
};

export type ModelPrice = {
  /** Normalized model ids this price applies to (see `normalizeModelId`). */
  ids: string[];
  label: string;
  vendor: string;
  currency: "USD";
  /** Ordered by `upToPromptTokens`; a request above the last bounded tier stays unpriced. */
  tiers: PriceTier[];
  /** Dated price changes announced by the vendor: [effectiveFrom, effectiveUntil), UTC dates. */
  effectiveFrom?: string;
  effectiveUntil?: string;
  offPeak?: OffPeakRule;
  /** Assumption made to apply this price, shown with the estimate. */
  note?: string;
  source: string;
  checkedOn: string;
};

const ANTHROPIC_PRICING = "https://platform.claude.com/docs/en/about-claude/pricing";
const ANTHROPIC_CHECKED_ON = "2026-10-06";

/** Anthropic bills cache reads at 0.1x and 5-minute cache writes at 1.25x the base input price. */
function anthropic(ids: string[], label: string, inputPerMTok: number, outputPerMTok: number, upToPromptTokens?: number): ModelPrice {
  return {
    ids, label, vendor: "Anthropic", currency: "USD",
    tiers: [{ upToPromptTokens, inputPerMTok, outputPerMTok, cacheReadPerMTok: inputPerMTok * 0.1, cacheWritePerMTok: inputPerMTok * 1.25 }],
    source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON
  };
}

const OPENAI_PRICING = "https://developers.openai.com/api/docs/pricing";
const OPENAI_CHECKED_ON = "2026-10-21";
/** OpenAI's short/long context boundary: "Long: >272K input tokens". */
const OPENAI_SHORT_CONTEXT = 272_000;
const OPENAI_CACHE_WRITE_NOTE = "Écritures de cache au tarif 30 min, la durée par défaut (Codex ne précise pas la durée demandée).";

type Rates = [input: number, cachedInput: number, cacheWrite: number | undefined, output: number];
const rates = ([inputPerMTok, cacheReadPerMTok, cacheWritePerMTok, outputPerMTok]: Rates): PriceTier => ({ inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok });

/**
 * GPT-5.6 and later bill cache writes (1.25x input for the default 30-minute
 * lifetime); earlier models have "no additional cache-write charge", so
 * written tokens cost plain input. `long` holds the >272K-token prices.
 */
function openai(id: string, label: string, short: Rates, long?: Rates, extra: Partial<ModelPrice> = {}): ModelPrice {
  const tiers = long ? [{ ...rates(short), upToPromptTokens: OPENAI_SHORT_CONTEXT }, rates(long)] : [rates(short)];
  return {
    ids: [id], label, vendor: "OpenAI", currency: "USD", tiers,
    note: short[2] !== undefined && short[2] !== short[0] ? OPENAI_CACHE_WRITE_NOTE : undefined,
    source: OPENAI_PRICING, checkedOn: OPENAI_CHECKED_ON, ...extra
  };
}

const GOOGLE_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";
const GOOGLE_CHECKED_ON = "2026-10-21";
/** Gemini Pro models switch to higher rates for "prompts > 200k tokens". */
const GEMINI_LONG_PROMPT = 200_000;
const GEMINI_NOTE = "Tarif texte ; le coût de stockage du cache explicite n’est pas compté.";

/** Gemini output prices include thinking tokens; the context caching price applies to cached prompt tokens. */
function gemini(ids: string[], label: string, [inputPerMTok, outputPerMTok, cacheReadPerMTok]: [number, number, number], extra: Partial<ModelPrice> = {}): ModelPrice {
  return { ids, label, vendor: "Google", currency: "USD", tiers: [{ inputPerMTok, outputPerMTok, cacheReadPerMTok }], note: GEMINI_NOTE, source: GOOGLE_PRICING, checkedOn: GOOGLE_CHECKED_ON, ...extra };
}

function geminiPro(ids: string[], label: string, base: [number, number, number], long: [number, number, number]): ModelPrice {
  const tier = ([inputPerMTok, outputPerMTok, cacheReadPerMTok]: [number, number, number]) => ({ inputPerMTok, outputPerMTok, cacheReadPerMTok });
  return { ...gemini(ids, label, base), tiers: [{ ...tier(base), upToPromptTokens: GEMINI_LONG_PROMPT }, tier(long)] };
}

const ALIBABA_PRICING = "https://www.alibabacloud.com/help/en/model-studio/model-pricing";
const ALIBABA_CHECKED_ON = "2026-10-21";
const ALIBABA_NOTE = "Tarif Singapour (international), prix catalogue hors promotion. Qwen Code active le cache explicite : lectures à 10 % du prix d’entrée ; la création de cache (125 %) n’est pas rapportée et reste comptée au prix d’entrée.";

/**
 * Model Studio tiers by "the total number of input tokens in a single
 * request" (K = 1,000). Cache hits under the explicit cache Qwen Code turns
 * on by default cost 10% of the tier's input price (Context Cache page);
 * `cache: false` for models whose hit rate the page leaves unstated.
 */
function alibaba(ids: string[], label: string, tiers: Array<[upTo: number, input: number, output: number]>, cache = true): ModelPrice {
  return {
    ids, label, vendor: "Alibaba Cloud", currency: "USD",
    tiers: tiers.map(([upToPromptTokens, inputPerMTok, outputPerMTok]) => ({ upToPromptTokens, inputPerMTok, outputPerMTok, cacheReadPerMTok: cache ? inputPerMTok * 0.1 : undefined })),
    note: ALIBABA_NOTE, source: ALIBABA_PRICING, checkedOn: ALIBABA_CHECKED_ON
  };
}

const DEEPSEEK_PRICING = "https://api-docs.deepseek.com/quick_start/pricing";
const DEEPSEEK_CHECKED_ON = "2026-10-21";
/** "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday." */
const DEEPSEEK_OFF_PEAK: OffPeakRule = { multiplier: 0.5, peakHoursUtc: [[1, 4], [6, 10]] };

function deepseek(ids: string[], label: string, [cacheReadPerMTok, inputPerMTok, outputPerMTok]: [number, number, number]): ModelPrice {
  return {
    ids, label, vendor: "DeepSeek", currency: "USD", tiers: [{ inputPerMTok, outputPerMTok, cacheReadPerMTok }], offPeak: DEEPSEEK_OFF_PEAK,
    note: "Tarif heures pleines / creuses selon l’heure de la requête ; les jours fériés chinois (heures creuses) sont comptés au tarif plein.",
    source: DEEPSEEK_PRICING, checkedOn: DEEPSEEK_CHECKED_ON
  };
}

const MOONSHOT_PRICING = "https://platform.kimi.ai/docs/pricing/chat";
const MOONSHOT_CHECKED_ON = "2026-10-21";

function moonshot(id: string, label: string, tier: PriceTier, note?: string): ModelPrice {
  return { ids: [id], label, vendor: "Moonshot AI", currency: "USD", tiers: [tier], note, source: MOONSHOT_PRICING, checkedOn: MOONSHOT_CHECKED_ON };
}

export const MODEL_PRICES: ModelPrice[] = [
  anthropic(["claude-fable-5-1"], "Claude Fable 5.1", 10, 50),
  anthropic(["claude-fable-5"], "Claude Fable 5", 10, 50),
  anthropic(["claude-opus-5-5"], "Claude Opus 5.5", 4, 20),
  anthropic(["claude-opus-5"], "Claude Opus 5", 5, 25),
  anthropic(["claude-opus-4-8"], "Claude Opus 4.8", 5, 25),
  anthropic(["claude-opus-4-7"], "Claude Opus 4.7", 5, 25),
  anthropic(["claude-opus-4-6"], "Claude Opus 4.6", 5, 25),
  anthropic(["claude-sonnet-5-5"], "Claude Sonnet 5.5", 2, 10),
  anthropic(["claude-sonnet-5"], "Claude Sonnet 5", 2, 10),
  anthropic(["claude-sonnet-4-6"], "Claude Sonnet 4.6", 3, 15),
  // Higher rate beyond 100K input tokens per request, not given: such requests stay unpriced.
  anthropic(["claude-haiku-5-5"], "Claude Haiku 5.5", 0.1, 0.5, 100_000),
  anthropic(["claude-haiku-4-5"], "Claude Haiku 4.5", 1, 5),

  // [input, cached input, cache write (30 min), output]; second array: >272K-token request.
  openai("gpt-6-astra", "GPT-6 Astra", [10, 1, 12.5, 50], [20, 2, 25, 75]),
  openai("gpt-6.1-sol", "GPT-6.1 Sol", [2, 0.1, 2.5, 10], [4, 0.2, 5, 15]),
  openai("gpt-6-sol", "GPT-6 Sol", [2, 0.2, 2.5, 10], [4, 0.4, 5, 15]),
  openai("gpt-6-luna", "GPT-6 Luna", [0.1, 0.01, 0.125, 0.5], [0.2, 0.02, 0.25, 0.75]),
  // Promotional price "available at least through November 21, 2026": re-check before extending.
  openai("gpt-5.6-sol", "GPT-5.6 Sol", [4, 0.4, 5, 20], [8, 0.8, 10, 30], { effectiveUntil: "2026-11-22" }),
  openai("gpt-5.6-terra", "GPT-5.6 Terra", [2, 0.2, 2.5, 12], [4, 0.4, 5, 18]),
  openai("gpt-5.6-luna", "GPT-5.6 Luna", [0.2, 0.02, 0.25, 1.2], [0.4, 0.04, 0.5, 1.8]),
  openai("gpt-5.5", "GPT-5.5", [5, 0.5, 5, 30], [10, 1, 10, 45]),
  openai("gpt-5.4", "GPT-5.4", [2.5, 0.25, 2.5, 15], [5, 0.5, 5, 22.5]),
  openai("gpt-5.4-mini", "GPT-5.4 mini", [0.75, 0.075, 0.75, 4.5]),
  openai("gpt-5.4-nano", "GPT-5.4 nano", [0.2, 0.02, 0.2, 1.25]),
  openai("gpt-5.3-codex", "GPT-5.3-Codex", [1.75, 0.175, 1.75, 14]),
  openai("gpt-5.2", "GPT-5.2", [1.75, 0.175, 1.75, 14]),
  openai("gpt-5.1", "GPT-5.1", [1.25, 0.125, 1.25, 10]),
  openai("gpt-5", "GPT-5", [1.25, 0.125, 1.25, 10]),
  openai("gpt-5-mini", "GPT-5 mini", [0.25, 0.025, 0.25, 2]),
  openai("gpt-5-nano", "GPT-5 nano", [0.05, 0.005, 0.05, 0.4]),

  // [input, output (thinking included), context caching].
  gemini(["gemini-4-argon"], "Gemini 4 Argon", [2, 10, 0.1], { effectiveUntil: "2026-12-01" }),
  gemini(["gemini-4-argon"], "Gemini 4 Argon", [4, 20, 0.2], { effectiveFrom: "2026-12-01" }),
  gemini(["gemini-3.8-flash"], "Gemini 3.8 Flash", [0.75, 3.75, 0.075], { effectiveUntil: "2027-01-01" }),
  gemini(["gemini-3.8-flash"], "Gemini 3.8 Flash", [1.5, 7.5, 0.15], { effectiveFrom: "2027-01-01" }),
  gemini(["gemini-3.6-flash"], "Gemini 3.6 Flash", [0.75, 3.75, 0.075], { effectiveUntil: "2027-01-01" }),
  gemini(["gemini-3.6-flash"], "Gemini 3.6 Flash", [1.5, 7.5, 0.15], { effectiveFrom: "2027-01-01" }),
  gemini(["gemini-3.5-flash-lite"], "Gemini 3.5 Flash-Lite", [0.3, 2.5, 0.03]),
  geminiPro(["gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools"], "Gemini 3.1 Pro Preview", [2, 12, 0.2], [4, 18, 0.4]),
  gemini(["gemini-3.1-flash-lite"], "Gemini 3.1 Flash-Lite", [0.25, 1.5, 0.025]),
  gemini(["gemini-3-flash-preview"], "Gemini 3 Flash Preview", [0.5, 3, 0.05]),
  geminiPro(["gemini-2.5-pro"], "Gemini 2.5 Pro", [1.25, 10, 0.125], [2.5, 15, 0.25]),
  gemini(["gemini-2.5-flash"], "Gemini 2.5 Flash", [0.3, 2.5, 0.03]),
  gemini(["gemini-2.5-flash-lite"], "Gemini 2.5 Flash-Lite", [0.1, 0.4, 0.01]),

  // [highest input tokens per request, input, output]; same price in thinking and non-thinking modes.
  alibaba(["qwen3-coder-flash", "qwen3-coder-flash-2025-07-28"], "Qwen3-Coder-Flash", [[32_000, 0.3, 1.5], [128_000, 0.5, 2.5], [256_000, 0.8, 4], [1_000_000, 1.6, 9.6]]),
  alibaba(["qwen3.8-max", "qwen3.8-max-0902"], "Qwen3.8-Max", [[1_000_000, 2, 6]], false),
  alibaba(["qwen3.7-max", "qwen3.7-max-2026-06-08", "qwen3.7-max-2026-05-20"], "Qwen3.7-Max", [[1_000_000, 2.5, 7.5]]),
  alibaba(["qwen3.7-plus", "qwen3.7-plus-2026-05-26"], "Qwen3.7-Plus", [[256_000, 0.4, 1.6], [1_000_000, 1.2, 4.8]]),
  alibaba(["qwen3.6-plus", "qwen3.6-plus-2026-04-02"], "Qwen3.6-Plus", [[256_000, 0.5, 3], [1_000_000, 2, 6]]),
  alibaba(["qwen3.5-plus", "qwen3.5-plus-2026-04-20", "qwen3.5-plus-2026-02-15"], "Qwen3.5-Plus", [[256_000, 0.4, 2.4], [1_000_000, 0.5, 3]]),
  alibaba(["qwen3.8-flash"], "Qwen3.8-Flash", [[1_000_000, 0.15, 0.47]], false),
  alibaba(["qwen3.7-flash", "qwen3.7-flash-2026-07-15"], "Qwen3.7-Flash", [[32_000, 0.03, 0.13], [256_000, 0.1, 0.4], [1_000_000, 0.2, 0.8]]),
  alibaba(["qwen3.6-flash", "qwen3.6-flash-2026-04-16"], "Qwen3.6-Flash", [[256_000, 0.25, 1.5], [1_000_000, 1, 4]]),
  alibaba(["qwen3.5-flash", "qwen3.5-flash-2026-02-23"], "Qwen3.5-Flash", [[1_000_000, 0.1, 0.4]]),

  // Peak rates [cache hit, cache miss, output]; legacy `deepseek-v4-flash` is "billed at the Flash price".
  deepseek(["deepseek-flash", "deepseek-v4-flash"], "DeepSeek Flash (V4.1-Flash-1017)", [0.006, 0.3, 1.2]),
  deepseek(["deepseek-v4-pro"], "DeepSeek V4 Pro", [0.044, 1.32, 3.96]),

  // K3 bills cache writes (5-minute TTL by default); K2 models have no write charge, so written tokens cost plain input.
  moonshot("kimi-k3", "Kimi K3", { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3 }, "Écritures de cache au tarif 5 min, la durée par défaut."),
  moonshot("kimi-k2.7-code", "Kimi K2.7 Code", { inputPerMTok: 0.95, outputPerMTok: 4, cacheReadPerMTok: 0.19, cacheWritePerMTok: 0.95 }),
  moonshot("kimi-k2.7-code-highspeed", "Kimi K2.7 Code Highspeed", { inputPerMTok: 1.9, outputPerMTok: 8, cacheReadPerMTok: 0.38, cacheWritePerMTok: 1.9 }),
  moonshot("kimi-k2.6", "Kimi K2.6", { inputPerMTok: 0.95, outputPerMTok: 4, cacheReadPerMTok: 0.16, cacheWritePerMTok: 0.95 })
];

/**
 * Normalizes the model strings connectors report: lowercase, provider prefix
 * dropped (`anthropic/claude-…`), and a trailing snapshot date removed
 * (`claude-haiku-4-5-20251001`). No fuzzy or prefix matching, so `gpt-5`
 * never borrows the price of `gpt-5-mini` or the reverse.
 */
export function normalizeModelId(model: string) {
  const bare = model.trim().toLowerCase().split("/").at(-1) ?? "";
  return bare.replace(/[-@]\d{8}$/, "");
}

/** Price in force for `model` at `at` (ISO timestamp, default now), honouring dated price changes. */
export function findModelPrice(model: string, prices: ModelPrice[] = MODEL_PRICES, at: string = new Date().toISOString()): ModelPrice | null {
  const id = normalizeModelId(model);
  const day = at.slice(0, 10);
  return prices.find((price) => price.ids.includes(id) && (!price.effectiveFrom || day >= price.effectiveFrom) && (!price.effectiveUntil || day < price.effectiveUntil)) ?? null;
}

export type RequestTokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * Cost of one request in USD, or null when the table cannot price it: prompt
 * above the last known tier, or cache tokens without a published cache rate.
 */
export function priceRequest(price: ModelPrice, tokens: RequestTokens, at: string): number | null {
  // Tiers count every prompt token of the request, cached or not.
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const tier = price.tiers.find((candidate) => candidate.upToPromptTokens === undefined || prompt <= candidate.upToPromptTokens);
  if (!tier) return null;
  if ((tokens.cacheRead && tier.cacheReadPerMTok === undefined) || (tokens.cacheWrite && tier.cacheWritePerMTok === undefined)) return null;
  const cost = (tokens.input * tier.inputPerMTok + tokens.output * tier.outputPerMTok + tokens.cacheRead * (tier.cacheReadPerMTok ?? 0) + tokens.cacheWrite * (tier.cacheWritePerMTok ?? 0)) / 1_000_000;
  return price.offPeak && !isPeak(price.offPeak, at) ? cost * price.offPeak.multiplier : cost;
}

function isPeak(rule: OffPeakRule, at: string) {
  const date = new Date(at);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const hour = date.getUTCHours();
  return rule.peakHoursUtc.some(([start, end]) => hour >= start && hour < end);
}
