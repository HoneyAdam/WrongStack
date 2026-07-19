import type { SlashCommand } from '@wrongstack/core';

export interface ContextSlashDeps {
  /** Bridge from slash-command execution to the mounted TUI reducer. */
  onPanelOpen?: { current: ((action: string) => boolean) | null } | undefined;
  /** Small history-safe snapshot shown after the interactive panel opens. */
  getSummary?: (() => ContextPanelSummary) | undefined;
}

export interface ContextPanelSummary {
  contextPct?: number | undefined;
  contextTokens?: number | undefined;
  contextMaxTokens?: number | undefined;
  memoryTotal?: number | undefined;
  memoryCtx: number;
  memoryPending: number;
  memoryLeft: number;
}

/** Compact context-pressure bar shared by the interactive Ink panel. */
export function contextBar(pct: number, width: number): string {
  if (pct <= 0) return `[${'░'.repeat(width)}]   0%`;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const label = ` ${(pct * 100).toFixed(0)}%`;
  const bar = `[${'█'.repeat(Math.max(1, filled))}${'░'.repeat(Math.max(0, empty))}]`;
  return bar.length + label.length <= width + 4
    ? `${bar}${label}`
    : `${'█'.repeat(Math.max(1, filled))}${'░'.repeat(Math.max(0, empty))} ${label}`;
}

/** TUI `/context` is panel-first; history receives only a compact snapshot. */
export function createContextSlashCommand(deps: ContextSlashDeps): SlashCommand {
  return {
    name: 'context',
    description: 'Open the interactive provider-context and Super Memory monitor.',
    argsHint: '',
    category: 'Inspect',
    help:
      'Usage:\n' +
      '  /context                  — open the interactive context monitor\n' +
      '  /context window           — same as above\n' +
      '  /context --window         — same as above\n',
    async run(args: string) {
      const trimmed = args.trim().toLowerCase();
      const panelRequest = trimmed === '' || trimmed === 'window' || trimmed === '--window';
      if (!panelRequest) return { message: 'Usage: /context [window]' };

      const opened = deps.onPanelOpen?.current?.('toggleContextPanel') ?? false;
      return {
        message: opened
          ? formatContextPanelSummary(deps.getSummary?.())
          : 'Interactive context panel is unavailable in this TUI instance.',
      };
    },
  };
}

export function formatContextPanelSummary(summary: ContextPanelSummary | undefined): string {
  if (!summary) return 'Context panel opened.';
  const contextParts = ['Context panel opened'];
  if (summary.contextPct !== undefined) {
    contextParts.push(`${Math.round(Math.max(0, summary.contextPct) * 100)}%`);
  }
  if (
    summary.contextTokens !== undefined &&
    summary.contextMaxTokens !== undefined &&
    summary.contextMaxTokens > 0
  ) {
    contextParts.push(
      `${formatTokens(summary.contextTokens)}/${formatTokens(summary.contextMaxTokens)}`,
    );
  }

  const memoryParts = [
    'Memory',
    summary.memoryTotal === undefined ? undefined : `${summary.memoryTotal} total`,
    `${summary.memoryCtx} ctx`,
    `${summary.memoryPending} pending`,
    summary.memoryLeft > 0 ? `${summary.memoryLeft} left` : undefined,
  ].filter((part): part is string => part !== undefined);
  return `${contextParts.join(' · ')}\n${memoryParts.join(' · ')}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}
