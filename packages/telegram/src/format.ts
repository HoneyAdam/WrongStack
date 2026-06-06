// ---------------------------------------------------------------------------
// Humanizers for agent events forwarded to Telegram.
//
// The host emits rich structured events; this module turns them into short,
// readable chat messages. Kept pure (no bot / IO) so it's trivially testable.
// ---------------------------------------------------------------------------

/** Subset of the core `delegate.completed` event payload we render. */
export interface DelegateCompletedLike {
  target: string;
  task: string;
  ok: boolean;
  status?: string;
  summary: string;
  durationMs: number;
  iterations: number;
  toolCalls: number;
  costUsd?: number;
  subagentId?: string;
}

/** Compact human duration: `42s`, `3m`, `1.5h`. */
export function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Render a finished delegation as a readable Telegram message instead of the
 * raw, truncated JSON the generic `tool.executed` notifier would produce.
 *
 * Example:
 *   ✅ Delegate → bug-hunter · success
 *   Found 3 null-deref risks in auth.ts and patched the worst one…
 *   ⏱ 3m · 4 iter · 37 tools · 💲0.0820
 */
export function formatDelegateCompleted(e: DelegateCompletedLike): string {
  const icon = e.ok ? '✅' : '❌';
  const status = e.status ?? (e.ok ? 'success' : 'failed');
  const task = e.task.length > 160 ? `${e.task.slice(0, 159)}…` : e.task;

  // Prefer the host's one-line summary; fall back to echoing the task when a
  // failure produced no summary.
  const body = e.summary?.trim() || `(no summary) — ${task}`;

  const stats = [
    `⏱ ${fmtDuration(e.durationMs)}`,
    `${e.iterations} iter`,
    `${e.toolCalls} tools`,
  ];
  if (typeof e.costUsd === 'number' && e.costUsd > 0) {
    stats.push(`💲${e.costUsd.toFixed(4)}`);
  }

  return [`${icon} Delegate → ${e.target} · ${status}`, body, stats.join(' · ')].join('\n');
}
