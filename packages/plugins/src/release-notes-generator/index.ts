/**
 * release-notes-generator plugin — generates grouped release notes from git
 * history using conventional-commit parsing.
 *
 * Tool registered:
 * - generate_release_notes : Produce grouped notes between two refs.
 *
 * No hooks are registered.
 *
 * Config (`config.extensions['release-notes-generator']`):
 *
 * ```jsonc
 * {
 *   "enabled": true,
 *   "includeScope": true,
 *   "defaultFrom": "latest-tag"
 * }
 * ```
 *
 * @public
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import type { Plugin } from '@wrongstack/core';

const API_VERSION = '^0.1.10';

// ---------------------------------------------------------------------------
// Module-scope state (H1 audit pattern)
// ---------------------------------------------------------------------------

interface ReleaseNotesGeneratorState {
  generateCount: number;
  commitCount: number;
  errorCount: number;
}

const state: ReleaseNotesGeneratorState = {
  generateCount: 0,
  commitCount: 0,
  errorCount: 0,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface ReleaseNotesGeneratorConfig {
  enabled: boolean;
  includeScope: boolean;
  defaultFrom: string;
}

const DEFAULTS: ReleaseNotesGeneratorConfig = {
  enabled: true,
  includeScope: true,
  defaultFrom: 'latest-tag',
};

function readConfig(raw: unknown): ReleaseNotesGeneratorConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r['enabled'] !== false,
    includeScope: r['includeScope'] !== false,
    defaultFrom: typeof r['defaultFrom'] === 'string' ? r['defaultFrom'] : DEFAULTS.defaultFrom,
  };
}

// ---------------------------------------------------------------------------
// Git + conventional commits
// ---------------------------------------------------------------------------

type CommitType = 'feat' | 'fix' | 'docs' | 'refactor' | 'perf' | 'test' | 'chore';

const CONVENTIONAL_TYPES: CommitType[] = ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'chore'];

interface Commit {
  hash: string;
  subject: string;
  type: CommitType | 'uncategorized';
  scope: string | null;
  description: string;
}

function parseConventionalCommit(subject: string): { type: CommitType | 'uncategorized'; scope: string | null; description: string } {
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!match) {
    return { type: 'uncategorized', scope: null, description: subject };
  }
  const rawType = match[1]!;
  const scope = match[2] ?? null;
  const description = match[3]!;
  const type = CONVENTIONAL_TYPES.includes(rawType as CommitType) ? (rawType as CommitType) : 'uncategorized';
  return { type, scope, description };
}

function formatCommit(c: Commit, includeScope: boolean): string {
  let line = `- ${c.hash.slice(0, 7)}`;
  if (includeScope && c.scope) {
    line += ` [${c.scope}]`;
  }
  line += ` ${c.description}`;
  return line;
}

const GIT_OPTIONS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'ignore'],
  shell: false,
};

function resolveFromRef(defaultFrom: string, inputFrom?: string): string {
  if (inputFrom) return inputFrom;
  if (defaultFrom === 'latest-tag') {
    try {
      return execFileSync('git', ['describe', '--tags', '--abbrev=0'], GIT_OPTIONS).trim();
    } catch {
      return '';
    }
  }
  return defaultFrom;
}

function resolveCommit(ref: string): string {
  const resolved = execFileSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    GIT_OPTIONS,
  ).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(resolved)) {
    throw new Error(`git returned an invalid commit id for ref ${JSON.stringify(ref)}`);
  }
  return resolved;
}

function getCommits(from: string, to: string): Commit[] {
  const toCommit = resolveCommit(to);
  const range = from ? `${resolveCommit(from)}..${toCommit}` : toCommit;
  const output = execFileSync(
    'git',
    ['log', '--pretty=format:%H%x09%s', '--end-of-options', range],
    GIT_OPTIONS,
  );
  if (!output.trim()) return [];

  const commits: Commit[] = [];
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const hash = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    const parsed = parseConventionalCommit(subject);
    commits.push({ hash, subject, ...parsed });
  }
  return commits;
}

function groupCommits(commits: Commit[]): Record<string, Commit[]> {
  const groups: Record<string, Commit[]> = {};
  for (const c of commits) {
    const key = c.type;
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(c);
  }
  return groups;
}

function generateNotes(commits: Commit[], includeScope: boolean): string {
  if (commits.length === 0) return 'No commits found.';
  const groups = groupCommits(commits);
  const lines: string[] = [];
  lines.push(`## Release Notes (${commits.length} commit${commits.length === 1 ? '' : 's'})`);
  lines.push('');

  const order: CommitType[] = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore'];
  for (const type of order) {
    const list = groups[type];
    if (!list || list.length === 0) continue;
    lines.push(`### ${type}`);
    for (const c of list) {
      lines.push(formatCommit(c, includeScope));
    }
    lines.push('');
  }

  const uncategorized = groups['uncategorized'];
  if (uncategorized && uncategorized.length > 0) {
    lines.push('### Uncategorized');
    for (const c of uncategorized) {
      lines.push(formatCommit(c, includeScope));
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: 'release-notes-generator',
  version: '0.1.0',
  description: 'Generates grouped release notes from conventional commits between two git refs',
  apiVersion: API_VERSION,
  capabilities: { tools: true },
  defaultConfig: { ...DEFAULTS },
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true, description: 'Master switch.' },
      includeScope: {
        type: 'boolean',
        default: true,
        description: 'Include commit scopes in the formatted notes.',
      },
      defaultFrom: {
        type: 'string',
        default: 'latest-tag',
        description: 'Default starting ref when `from` is omitted. Use "latest-tag" to discover the most recent tag.',
      },
    },
  },

  setup(api) {
    state.generateCount = 0;
    state.commitCount = 0;
    state.errorCount = 0;

    const cfg = readConfig(api.config.extensions?.['release-notes-generator']);

    // --- generate_release_notes tool ---
    api.tools.register({
      name: 'generate_release_notes',
      description:
        'Generate release notes by grouping conventional commits between two git refs. Defaults to the latest tag..HEAD.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Starting git ref (tag, commit, branch). Defaults to the configured defaultFrom.',
          },
          to: {
            type: 'string',
            default: 'HEAD',
            description: 'Ending git ref.',
          },
        },
      },
      permission: 'auto',
      category: 'Development',
      mutating: false,
      async execute(input: { from?: string; to?: string }) {
        if (!cfg.enabled) return { ok: false, error: 'release-notes-generator is disabled' };

        const toRef = typeof input.to === 'string' ? input.to : 'HEAD';
        const fromRef = resolveFromRef(cfg.defaultFrom, input.from);

        state.generateCount += 1;
        let commits: Commit[];
        try {
          commits = getCommits(fromRef, toRef);
        } catch (err) {
          state.errorCount += 1;
          return { ok: false, error: String(err) };
        }
        state.commitCount += commits.length;

        return {
          ok: true,
          from: fromRef || null,
          to: toRef,
          commitCount: commits.length,
          notes: generateNotes(commits, cfg.includeScope),
        };
      },
    });

    api.log.info('release-notes-generator plugin loaded', {
      version: '0.1.0',
      defaultFrom: cfg.defaultFrom,
      includeScope: cfg.includeScope,
    });
  },

  teardown(api) {
    const final = {
      generated: state.generateCount,
      commits: state.commitCount,
      errors: state.errorCount,
    };
    state.generateCount = 0;
    state.commitCount = 0;
    state.errorCount = 0;
    api.log.info('release-notes-generator: teardown complete', { final });
  },

  async health() {
    return {
      ok: state.errorCount === 0,
      message: state.errorCount
        ? `release-notes-generator: ${state.errorCount} error(s)`
        : `release-notes-generator: ${state.generateCount} generation(s), ${state.commitCount} commit(s)`,
      counters: {
        generated: state.generateCount,
        commits: state.commitCount,
        errors: state.errorCount,
      },
    };
  },
};

export default plugin;
