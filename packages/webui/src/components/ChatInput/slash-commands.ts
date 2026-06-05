// Slash command registry and matching utilities for ChatInput

export type SlashCategory = 'Session' | 'Inspect' | 'Run' | 'App';

export interface SlashCommandDef {
  name: string;
  aliases?: string[];
  description: string;
  category: SlashCategory;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/help', category: 'App', description: 'Show every slash command and what it does' },
  { name: '/export', category: 'Session', description: 'Download the current chat as markdown' },
  { name: '/todos', category: 'Inspect', description: 'List current todos (try `/todos clear` to reset)' },
  { name: '/clear', category: 'Session', description: 'Wipe current context (keeps session id, disk record stays)' },
  { name: '/new', category: 'Session', description: 'Start a brand-new session (fresh on disk and in memory)' },
  { name: '/compact', category: 'Session', description: 'Shrink context — elide ancient tool output' },
  { name: '/repair', category: 'Session', description: 'Repair orphan tool_use/tool_result blocks in context' },
  { name: '/debug', category: 'Inspect', aliases: ['/context'], description: 'Per-section context size breakdown' },
  { name: '/tools', category: 'Inspect', description: 'List every registered tool the model can call' },
  { name: '/memory', category: 'Inspect', description: 'Show all remembered notes (project + user scope)' },
  { name: '/skill', category: 'Inspect', aliases: ['/skills'], description: 'List active skills' },
  { name: '/diag', category: 'Inspect', description: 'Runtime diagnostics (provider, tools, features, mode, usage)' },
  { name: '/stats', category: 'Inspect', description: 'Session stats: tokens, cache hit ratio, cost, elapsed' },
  { name: '/save', category: 'Session', description: 'Force-flush the session (auto-saved already)' },
  { name: '/abort', category: 'Run', aliases: ['/stop'], description: 'Abort the current run' },
  { name: '/settings', category: 'App', aliases: ['/model'], description: 'Open settings (provider/model/keys)' },
];

export const SLASH_CATEGORY_ORDER: SlashCategory[] = ['Run', 'Session', 'Inspect', 'App'];

export function matchSlash(query: string): SlashCommandDef[] {
  const q = query.toLowerCase();
  if (q === '/' || q === '') return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(q) || (c.aliases?.some((a) => a.startsWith(q)) ?? false),
  );
}

export function detectAtMention(value: string, cursor: number): { start: number; query: string } | null {
  let i = cursor - 1;
  while (i >= 0) {
    const c = value[i]!;
    if (c === '@') {
      const prev = i > 0 ? value[i - 1] : '';
      if (i === 0 || /\s/.test(prev ?? '')) {
        return { start: i, query: value.slice(i + 1, cursor) };
      }
      return null;
    }
    if (/\s/.test(c)) return null;
    i--;
  }
  return null;
}
