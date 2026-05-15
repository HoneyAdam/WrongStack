import type { SlashCommand } from '@wrongstack/core';
import type { QueueItem } from './app.js';

/**
 * Dependencies the `/queue` command needs from the App. The TUI registers
 * the command at mount time with closures over `getQueue` (reads the latest
 * queue snapshot via a ref) and the three mutators. The command returns
 * its output as `{ message }` which the App pipes into history as `info`.
 */
export interface QueueSlashDeps {
  getQueue: () => QueueItem[];
  clear: () => void;
  deleteAt: (positions: number[]) => void;
}

const USAGE =
  'Usage:\n' +
  '  /queue              — list pending messages\n' +
  '  /queue list         — same as /queue\n' +
  '  /queue clear        — drop all pending messages\n' +
  '  /queue delete N M…  — drop messages at 1-based positions';

export function createQueueSlashCommand(deps: QueueSlashDeps): SlashCommand {
  return {
    name: 'queue',
    description: 'List, clear, or delete pending messages typed while the agent was running.',
    async run(args) {
      const out = handleQueueCommand(args, deps);
      return { message: out };
    },
  };
}

/**
 * Pure logic for the /queue command. Exported separately so tests can
 * drive it without spinning up Ink.
 */
export function handleQueueCommand(args: string, deps: QueueSlashDeps): string {
  const trimmed = args.trim();
  const [sub, ...rest] = trimmed.split(/\s+/);
  const subcommand = sub?.toLowerCase() ?? '';

  if (subcommand === '' || subcommand === 'list') {
    return renderList(deps.getQueue());
  }

  if (subcommand === 'clear') {
    const before = deps.getQueue().length;
    if (before === 0) return 'Queue is already empty.';
    deps.clear();
    return `Cleared ${before} queued message${before === 1 ? '' : 's'}.`;
  }

  if (subcommand === 'delete' || subcommand === 'del' || subcommand === 'rm') {
    if (rest.length === 0) return 'Usage: /queue delete <position> [<position>…]';
    const queue = deps.getQueue();
    if (queue.length === 0) return 'Queue is empty — nothing to delete.';
    const parsed: number[] = [];
    const invalid: string[] = [];
    const outOfRange: number[] = [];
    for (const tok of rest) {
      if (!/^\d+$/.test(tok)) {
        invalid.push(tok);
        continue;
      }
      const n = Number.parseInt(tok, 10);
      if (n < 1 || n > queue.length) {
        outOfRange.push(n);
        continue;
      }
      parsed.push(n);
    }
    const uniqueValid = [...new Set(parsed)];
    if (uniqueValid.length === 0) {
      const parts = ['No valid positions to delete.'];
      if (invalid.length > 0) parts.push(`Invalid: ${invalid.join(', ')}.`);
      if (outOfRange.length > 0)
        parts.push(`Out of range (queue has ${queue.length}): ${outOfRange.join(', ')}.`);
      return parts.join(' ');
    }
    deps.deleteAt(uniqueValid);
    const parts = [
      `Deleted ${uniqueValid.length} of ${queue.length} (positions ${uniqueValid.sort((a, b) => a - b).join(', ')}).`,
    ];
    if (invalid.length > 0) parts.push(`Ignored invalid: ${invalid.join(', ')}.`);
    if (outOfRange.length > 0) parts.push(`Ignored out of range: ${outOfRange.join(', ')}.`);
    return parts.join(' ');
  }

  return `Unknown subcommand "${sub}".\n${USAGE}`;
}

function renderList(queue: QueueItem[]): string {
  if (queue.length === 0) return 'Queue is empty.';
  const lines = [`Queue (${queue.length}):`];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (!item) continue;
    const preview = oneLine(item.displayText, 100);
    lines.push(`  ${i + 1}. ${preview}`);
  }
  return lines.join('\n');
}

function oneLine(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
