/**
 * Format a millisecond delay as a human-readable string (e.g. "30s", "2m", "disabled").
 */
export function formatDelay(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  if (ms === 0) return 'disabled';
  return `${Math.round(ms / 1000)}s`;
}
