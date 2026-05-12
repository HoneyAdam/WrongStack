import type { Tool, InputReader } from '@wrongstack/core';
import { color } from '@wrongstack/core';
import { renderDiff } from './diff-renderer.js';
import { theme } from './theme.js';

export type PromptDecision = 'yes' | 'no' | 'always' | 'deny';

export function makePromptDelegate(reader: InputReader) {
  return async (
    tool: Tool,
    input: unknown,
    suggestedPattern: string,
  ): Promise<PromptDecision> => {
    process.stdout.write(`\n${theme.primary('▍')} ${theme.bold(tool.name)}\n`);
    process.stdout.write(`${color.dim(stringifyInput(input))}\n`);

    if (tool.name === 'edit' && hasDiff(input)) {
      const inp = input as { diff?: unknown };
      const diff = typeof inp.diff === 'string' ? inp.diff : '';
      if (diff) process.stdout.write(`${renderDiff(diff)}\n`);
    }

    process.stdout.write(color.dim('─────────────────\n'));
    const answer = await reader.readKey(
      `${theme.bold('[y]')}es  ${theme.bold('[n]')}o  ${theme.bold('[a]')}lways allow (${suggestedPattern})  ${theme.bold('[d]')}eny: `,
      [
        { key: 'y', label: 'yes', value: 'yes' },
        { key: 'n', label: 'no', value: 'no' },
        { key: 'a', label: 'always', value: 'always' },
        { key: 'd', label: 'deny', value: 'deny' },
      ],
    );
    return answer as PromptDecision;
  };
}

function stringifyInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  return Object.entries(obj)
    .filter(([k]) => k !== 'content' && k !== 'new_string')
    .map(([k, v]) => `${k}: ${truncate(JSON.stringify(v), 80)}`)
    .join('  ');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function hasDiff(input: unknown): boolean {
  return Boolean(
    input && typeof input === 'object' && 'diff' in (input as Record<string, unknown>),
  );
}
