/**
 * Pricing now lives in models.dev (fetched + cached via ModelsRegistry).
 * This module remains as a thin shim so older imports compile; consumers
 * should query `ModelsRegistry.getModel(provider, model).cost` directly.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** @deprecated Use ModelsRegistry. Always empty. */
export const PRICING: Record<string, ModelPrice> = {};

/** @deprecated Use ModelsRegistry.getModel(). Always returns undefined. */
export function priceFor(_model: string): ModelPrice | undefined {
  return undefined;
}
