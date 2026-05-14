/**
 * Format a token count for human-readable display.
 *   999 → "999"
 *   1_200 → "1.2k"
 *   12_000 → "12k"
 *   1_500_000 → "1.5M"
 */
export function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Return a new frozen config object with the given patch applied.
 * Config objects are frozen by the config loader — direct mutation
 * silently fails at runtime. This helper spreads + re-freezes safely.
 */
export function patchConfig<T extends object>(base: T, patch: Partial<T>): T {
  return Object.freeze({ ...base, ...patch }) as T;
}
