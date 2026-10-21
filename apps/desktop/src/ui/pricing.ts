// Public list prices used for the *estimated* session cost.
//
// Maintenance rules:
// - Add a model only with a price read from the provider's published pricing
//   page, and record that page and the date it was read in `source`/`checkedOn`.
// - Never add a guessed or "probably the same as" price: a model missing from
//   this table simply has no estimated cost in the UI.
// - Prices are USD per million tokens, standard (non-batch, non-priority) tier.
// - Cache prices apply only to tokens a connector reports apart as cache reads
//   or writes (Claude Code transcripts). Anthropic bills cache reads at 0.1x and
//   5-minute cache writes at 1.25x the base input price.

export type ModelPrice = {
  /** Normalized model ids this price applies to (see `normalizeModelId`). */
  ids: string[];
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
  currency: "USD";
  /** Price of prompt tokens read from / written to the provider cache; absent when unknown. */
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  /** Base rate only applies below this many input tokens per request. */
  baseRateMaxInputTokens?: number;
  source: string;
  checkedOn: string;
};

const ANTHROPIC_PRICING = "https://platform.claude.com/docs/en/about-claude/pricing";
const ANTHROPIC_CHECKED_ON = "2026-10-06";

/** Anthropic cache multipliers, from the same published pricing page. */
function withAnthropicCache(price: ModelPrice): ModelPrice {
  return { ...price, cacheReadPerMTok: price.inputPerMTok * 0.1, cacheWritePerMTok: price.inputPerMTok * 1.25 };
}

export const MODEL_PRICES: ModelPrice[] = ([
  { ids: ["claude-fable-5-1"], label: "Claude Fable 5.1", inputPerMTok: 10, outputPerMTok: 50, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-fable-5"], label: "Claude Fable 5", inputPerMTok: 10, outputPerMTok: 50, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-opus-5-5"], label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-opus-5"], label: "Claude Opus 5", inputPerMTok: 5, outputPerMTok: 25, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-opus-4-8"], label: "Claude Opus 4.8", inputPerMTok: 5, outputPerMTok: 25, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-opus-4-7"], label: "Claude Opus 4.7", inputPerMTok: 5, outputPerMTok: 25, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-opus-4-6"], label: "Claude Opus 4.6", inputPerMTok: 5, outputPerMTok: 25, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-sonnet-5-5"], label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-sonnet-5"], label: "Claude Sonnet 5", inputPerMTok: 2, outputPerMTok: 10, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-sonnet-4-6"], label: "Claude Sonnet 4.6", inputPerMTok: 3, outputPerMTok: 15, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  // Higher rate beyond 100K input tokens per request: such events stay unpriced.
  { ids: ["claude-haiku-5-5"], label: "Claude Haiku 5.5", inputPerMTok: 0.1, outputPerMTok: 0.5, currency: "USD", baseRateMaxInputTokens: 100_000, source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON },
  { ids: ["claude-haiku-4-5"], label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5, currency: "USD", source: ANTHROPIC_PRICING, checkedOn: ANTHROPIC_CHECKED_ON }
] satisfies ModelPrice[]).map(withAnthropicCache);

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

export function findModelPrice(model: string, prices: ModelPrice[] = MODEL_PRICES): ModelPrice | null {
  const id = normalizeModelId(model);
  return prices.find((price) => price.ids.includes(id)) ?? null;
}
