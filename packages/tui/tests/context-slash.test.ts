import { describe, expect, it, vi } from 'vitest';
import {
  contextBar,
  createContextSlashCommand,
  formatContextPanelSummary,
} from '../src/context-slash.js';

describe('/context TUI command', () => {
  it('opens the interactive panel for bare /context without rendering a legacy dump', async () => {
    const open = vi.fn(() => true);
    const command = createContextSlashCommand({ onPanelOpen: { current: open } });

    const result = await command.run('');

    expect(open).toHaveBeenCalledWith('toggleContextPanel');
    expect((result as { message: string }).message).toBe('Context panel opened.');
  });

  it.each(['window', '--window'])('keeps /context %s as a panel alias', async (arg) => {
    const open = vi.fn(() => true);
    const command = createContextSlashCommand({ onPanelOpen: { current: open } });

    const result = await command.run(arg);

    expect(open).toHaveBeenCalledWith('toggleContextPanel');
    expect((result as { message: string }).message).toBe('Context panel opened.');
  });

  it('never falls back to the removed Markdown dashboard', async () => {
    const command = createContextSlashCommand({});

    const result = await command.run('');

    expect((result as { message: string }).message).toContain('panel is unavailable');
    expect((result as { message: string }).message).not.toContain('Context Dashboard');
  });

  it('rejects unknown arguments instead of printing the removed dashboard', async () => {
    const command = createContextSlashCommand({});
    expect(((await command.run('legacy')) as { message: string }).message).toBe(
      'Usage: /context [window]',
    );
  });
});

describe('contextBar', () => {
  it('renders empty and partial pressure bars', () => {
    expect(contextBar(0, 10)).toContain('0%');
    expect(contextBar(0.5, 10)).toContain('50%');
    expect(contextBar(0.5, 10)).toContain('█████');
  });
});

describe('formatContextPanelSummary', () => {
  it('keeps the history entry compact while preserving useful counts', () => {
    expect(
      formatContextPanelSummary({
        contextPct: 0.28,
        contextTokens: 280_000,
        contextMaxTokens: 1_000_000,
        memoryTotal: 6262,
        memoryCtx: 2,
        memoryPending: 1,
        memoryLeft: 3,
      }),
    ).toBe(
      'Context panel opened · 28% · 280k/1m\nMemory · 6262 total · 2 ctx · 1 pending · 3 left',
    );
  });
});
