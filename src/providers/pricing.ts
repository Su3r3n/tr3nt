import type { ChatUsage } from './types';

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Prices come from configuration, never from a table baked into the source. Provider
 * pricing changes without warning, and a stale hardcoded number is worse than no number:
 * it produces a confident total that is quietly wrong.
 *
 * Unset means costs stay null. Token counts are still recorded, so cost can be computed
 * retroactively once the rates are known.
 */
export function pricingFromEnv(env: NodeJS.ProcessEnv = process.env): Pricing | null {
  const input = Number(env.TR3NT_PRICE_INPUT_PER_MTOK);
  const output = Number(env.TR3NT_PRICE_OUTPUT_PER_MTOK);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  return { inputPerMTok: input, outputPerMTok: output };
}

/** Returns a fixed-point string, because the cost_usd column is numeric(14, 6). */
export function estimateCostUsd(usage: ChatUsage, pricing: Pricing | null): string | null {
  if (!pricing) return null;
  const tokensIn = usage.tokensIn ?? 0;
  const tokensOut = usage.tokensOut ?? 0;
  if (tokensIn === 0 && tokensOut === 0) return null;
  const cost = (tokensIn / 1_000_000) * pricing.inputPerMTok + (tokensOut / 1_000_000) * pricing.outputPerMTok;
  return cost.toFixed(6);
}
