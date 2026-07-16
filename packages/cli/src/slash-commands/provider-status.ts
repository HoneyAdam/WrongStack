/**
 * `/provider-status` — view the live health status of every tracked
 * provider/model pair: which are healthy, degraded, or blocked, with
 * failure counts and last-error details.
 *
 * Persistence: the data is held in-memory by the
 * {@link ProviderModelStatusTracker} created at boot. The view is a
 * snapshot; it refreshes every time you run the command.
 *
 * Usage:
 *   /provider-status           Show all tracked statuses
 *   /provider-status blocked   Show only blocked entries
 *   /provider-status degraded  Show only degraded entries
 *   /provider-status healthy   Show only healthy entries
 *   /provider-status clear     Reset all tracking
 *   /provider-status clear <provider> <model>  Reset one pair
 */

import type { SlashCommand } from '@wrongstack/core';
import type { ProviderModelStatusTracker } from '@wrongstack/core/coordination';
import { color } from '@wrongstack/core';

export function buildProviderStatusCommand(
  tracker: ProviderModelStatusTracker,
): SlashCommand {
  const help = [
    'Usage:',
    '  /provider-status                  Show all tracked provider/model statuses',
    '  /provider-status blocked           Show only blocked entries',
    '  /provider-status degraded          Show only degraded entries',
    '  /provider-status healthy           Show only healthy entries',
    '  /provider-status clear             Reset all tracking data',
    '  /provider-status clear <p> <m>     Reset one provider/model pair',
    '',
    'Each entry shows the state, failure counts, and last error details.',
  ].join('\n');

  function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    const sec = Math.round((Date.now() - ms) / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s ago`;
    const hours = Math.floor(min / 60);
    return `${hours}h ${min % 60}m ago`;
  }

  function formatExpiry(ms: number | null): string {
    if (ms === null) return '—';
    const remaining = Math.max(0, ms - Date.now());
    if (remaining <= 0) return `${color.green('expired')} (will auto-recover)`;
    const sec = Math.round(remaining / 1000);
    if (sec < 60) return `${sec}s remaining`;
    const min = Math.floor(sec / 60);
    return `${min}m ${sec % 60}s remaining`;
  }

  function stateColor(state: 'healthy' | 'degraded' | 'blocked'): string {
    switch (state) {
      case 'healthy': return color.green('healthy');
      case 'degraded': return color.amber('degraded');
      case 'blocked': return color.red('blocked');
    }
  }

  function renderStatuses(): string {
    const snapshot = tracker.getSnapshot();
    const lines = [
      `${color.bold('WrongStack')} ${color.dim('— Provider/Model Status')}`,
      '',
      `  ${color.bold('Summary')}: ${snapshot.healthy} healthy · ${snapshot.degraded} degraded · ${snapshot.blocked} blocked`,
      `  Total failures: ${snapshot.totalFailures} · Rate limits: ${snapshot.totalRateLimits}`,
      '',
    ];

    if (snapshot.statuses.length === 0) {
      lines.push(`  ${color.dim('No tracked providers — no failures recorded yet.')}`);
      return lines.join('\n');
    }

    for (const s of snapshot.statuses) {
      const state = stateColor(s.state);
      const title = `${color.cyan(`${s.providerId}/${s.model}`)} ${state}`;
      lines.push(`  ${title}`);

      if (s.totalFailures > 0 || s.totalSuccesses > 0) {
        const failures = `${color.red(String(s.totalFailures))} failures`;
        const successes = `${color.green(String(s.totalSuccesses))} successes`;
        const rateLimits = s.rateLimitHits > 0
          ? ` · ${color.amber(`${s.rateLimitHits} rate-limited`)}`
          : '';
        lines.push(`    ${color.dim('totals:')} ${failures} · ${successes}${rateLimits}`);

        if (s.consecutiveFailures > 0) {
          lines.push(`    ${color.dim('consecutive failures:')} ${color.red(String(s.consecutiveFailures))}`);
        }

        if (s.lastFailureAt !== null) {
          const sessionInfo = s.lastSessionId
            ? ` session: ${color.dim(s.lastSessionId.slice(0, 12))}…`
            : '';
          const agentInfo = s.lastAgentId
            ? ` agent: ${color.dim(s.lastAgentId.slice(0, 16))}…`
            : '';
          lines.push(`    ${color.dim('last error:')} ${formatDuration(s.lastFailureAt)}${sessionInfo}${agentInfo}`);
          if (s.lastErrorMessage) {
            lines.push(`      ${color.red(s.lastErrorMessage.slice(0, 200))}`);
          }
        }

        if (s.stateExpiresAt !== null) {
          lines.push(`    ${color.dim('cooldown:')} ${formatExpiry(s.stateExpiresAt)}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  return {
    name: 'provider-status',
    category: 'Diagnostics',
    description: 'View the live health status of all providers/models (healthy, degraded, blocked).',
    argsHint: '[blocked | degraded | healthy | clear]',
    help,
    async run(args) {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] ?? '').toLowerCase();

      if (sub === 'help' || sub === '--help') return { message: this.help ?? '' };

      if (sub === 'blocked') {
        const blocked = tracker.getBlocked();
        if (blocked.length === 0) {
          return { message: `${color.green('No blocked providers/models.')}` };
        }
        return { message: renderStatuses() };
      }

      if (sub === 'degraded') {
        const degraded = tracker.getDegraded();
        if (degraded.length === 0) {
          return { message: `${color.green('No degraded providers/models.')}` };
        }
        return { message: renderStatuses() };
      }

      if (sub === 'healthy') {
        const all = tracker.getAllStatuses().filter((s) => s.state === 'healthy');
        if (all.length === 0) {
          return { message: `${color.dim('No healthy tracked providers — no failures recorded yet.')}` };
        }
        return { message: renderStatuses() };
      }

      if (sub === 'clear') {
        const provider = parts[1];
        const model = parts[2];
        if (provider && model) {
          tracker.clear(provider, model);
          return { message: `${color.green('✓')} Cleared tracking for ${color.cyan(`${provider}/${model}`)}.` };
        }
        tracker.clear();
        return { message: `${color.green('✓')} Cleared all provider/model tracking data.` };
      }

      if (sub && sub !== '') {
        return { message: `${color.red('Unknown subcommand')} "${sub}". Try ${color.dim('/provider-status')}, ${color.dim('/provider-status blocked')}, or ${color.dim('/provider-status help')}.` };
      }

      return { message: renderStatuses() };
    },
  };
}
