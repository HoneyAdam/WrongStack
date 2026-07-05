/**
 * migration-planner plugin — helps plan dependency or framework migrations.
 *
 * The plugin reads a package CHANGELOG (project root or node_modules) and
 * produces a migration checklist with breaking changes and recommended steps
 * between two versions. If no changelog is available it returns a generic
 * migration guide.
 *
 * Tools registered:
 * - migration_plan   — produce a migration checklist for a package/version range
 * - migration_status — report plugin state and counters
 *
 * Config (`config.extensions['migration-planner']`):
 *
 * ```jsonc
 * {
 *   "enabled": true,
 *   "changelogPaths": ["CHANGELOG.md"],
 *   "maxChars": 100_000
 * }
 * ```
 *
 * @public
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from '@wrongstack/core';

const API_VERSION = '^0.1.10';

// ---------------------------------------------------------------------------
// Module-scope state (H1 audit pattern)
// ---------------------------------------------------------------------------

interface MigrationPlannerState {
  plansGenerated: number;
  statusQueries: number;
  fallbackCount: number;
  lastPlan: {
    packageName: string;
    fromVersion: string;
    toVersion: string;
    scope?: string | undefined;
    breakingChanges: string[];
    recommendedSteps: string[];
    changelogSource: string | null;
  } | null;
  hookUnregister: null | (() => void);
}

const state: MigrationPlannerState = {
  plansGenerated: 0,
  statusQueries: 0,
  fallbackCount: 0,
  lastPlan: null,
  hookUnregister: null,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface MigrationPlannerConfig {
  enabled: boolean;
  changelogPaths: string[];
  maxChars: number;
}

const DEFAULTS: MigrationPlannerConfig = {
  enabled: true,
  changelogPaths: ['CHANGELOG.md'],
  maxChars: 100_000,
};

function readConfig(raw: unknown): MigrationPlannerConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r['enabled'] !== false,
    changelogPaths: Array.isArray(r['changelogPaths'])
      ? (r['changelogPaths'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : DEFAULTS.changelogPaths,
    maxChars:
      typeof r['maxChars'] === 'number' && r['maxChars'] >= 1_000 && r['maxChars'] <= 1_000_000
        ? r['maxChars']
        : DEFAULTS.maxChars,
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function withinProject(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return false;
  const root = process.cwd();
  const resolved = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, resolved);
  if (rel === '' || rel === '.') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Changelog parsing
// ---------------------------------------------------------------------------

function normalizeVersion(v: string): string {
  return v.replace(/^v/i, '').trim();
}

function readChangelog(
  packageName: string,
  cfg: MigrationPlannerConfig,
): { source: string; content: string } | null {
  const candidates = cfg.changelogPaths.map((p) => p.replace(/<package>/g, packageName));
  candidates.push(`node_modules/${packageName}/CHANGELOG.md`);
  candidates.push(`node_modules/${packageName}/changelog.md`);

  for (const candidate of candidates) {
    if (!withinProject(candidate)) continue;
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, 'utf-8');
        return { source: candidate, content: content.slice(0, cfg.maxChars) };
      } catch {
        // best-effort: try next candidate
      }
    }
  }
  return null;
}

interface VersionSection {
  version: string;
  header: string;
  body: string;
}

function extractVersionSections(
  changelog: string,
  fromVersion: string,
  toVersion: string,
): string[] {
  const fromNv = normalizeVersion(fromVersion);
  const toNv = normalizeVersion(toVersion);

  const sections: VersionSection[] = [];
  let current: VersionSection | null = null;

  for (const line of changelog.split(/\r?\n/)) {
    const match = line.match(/^#{2,3}\s+(\[?v?(\d+\.\d+\.\d+[^[\]\s]*)\]?)\s*(.*)$/);
    if (match) {
      if (current) sections.push(current);
      current = { version: normalizeVersion(match[2]!), header: match[1]!, body: '' };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) sections.push(current);

  if (sections.length === 0) return [changelog];

  const relevant: string[] = [];
  for (const section of sections) {
    if (section.version === toNv) {
      relevant.push(`## ${section.header}\n${section.body}`);
    } else if (section.version === fromNv) {
      break;
    } else if (relevant.length > 0) {
      relevant.push(`## ${section.header}\n${section.body}`);
    }
  }

  return relevant.length > 0 ? relevant : [changelog];
}

function extractBreakingChanges(sectionText: string): string[] {
  const breaking: string[] = [];
  let inBreakingSection = false;

  for (const rawLine of sectionText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      inBreakingSection = false;
      continue;
    }
    if (/^#{3,4}\s+(?:BREAKING\s+CHANGES?|Breaking\s+Changes?|Breaking)/i.test(line)) {
      inBreakingSection = true;
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      inBreakingSection = false;
      continue;
    }
    if (inBreakingSection) {
      const item = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
      if (item) breaking.push(item);
    } else if (
      /^\s*[-*]\s+.*(?:BREAKING|breaking|removed|deprecated|no longer supported)/i.test(rawLine)
    ) {
      breaking.push(line.replace(/^[-*]\s+/, ''));
    }
  }

  return breaking;
}

function extractRecommendedSteps(sectionText: string): string[] {
  const steps: string[] = [];
  let inMigrationSection = false;

  for (const rawLine of sectionText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      inMigrationSection = false;
      continue;
    }
    if (/^#{3,4}\s+(?:Migration|Upgrade|How to|Steps|Recommended)/i.test(line)) {
      inMigrationSection = true;
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      inMigrationSection = false;
      continue;
    }
    if (inMigrationSection) {
      const item = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
      if (item) steps.push(item);
    }
  }

  if (steps.length === 0) {
    steps.push('Review the changelog for deprecated APIs.');
    steps.push('Update imports and call sites to new API signatures.');
    steps.push('Run the test suite and fix regressions.');
    steps.push('Verify type-checking passes with the new version.');
  }

  return steps;
}

function buildGenericGuide(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  scope?: string,
): { breakingChanges: string[]; recommendedSteps: string[] } {
  return {
    breakingChanges: [
      `No changelog found for ${packageName}. Unknown breaking changes between ${fromVersion} and ${toVersion}.`,
    ],
    recommendedSteps: [
      `Visit ${packageName} release notes or GitHub releases for ${toVersion}.`,
      scope
        ? `Review ${scope} usage of ${packageName} for API changes.`
        : `Search the codebase for direct ${packageName} usage.`,
      `Update ${packageName} from ${fromVersion} to ${toVersion} in package.json.`,
      'Run install and the full test suite.',
      'Fix type errors and runtime regressions.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: 'migration-planner',
  version: '0.1.0',
  description:
    'Helps plan dependency or framework migrations by reading changelogs and producing checklists',
  apiVersion: API_VERSION,
  capabilities: { tools: true, hooks: true },
  defaultConfig: { ...DEFAULTS },
  configSchema: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        default: true,
        description: 'Master switch.',
      },
      changelogPaths: {
        type: 'array',
        items: { type: 'string' },
        default: ['CHANGELOG.md'],
        description: 'Changelog paths to try; <package> is replaced with the package name.',
      },
      maxChars: {
        type: 'number',
        minimum: 1_000,
        maximum: 1_000_000,
        default: 100_000,
        description: 'Maximum changelog characters to scan.',
      },
    },
  },

  setup(api) {
    // Idempotent re-init (H1 pattern).
    state.plansGenerated = 0;
    state.statusQueries = 0;
    state.fallbackCount = 0;
    state.lastPlan = null;
    state.hookUnregister = null;

    const cfg = readConfig(api.config.extensions?.['migration-planner']);

    // PostToolUse hook: remind about migration planning when package manifests change.
    const hook = (input: {
      toolName?: string | undefined;
      toolInput?: unknown;
      toolResult?: { content: string; isError: boolean } | undefined;
    }): { decision?: 'block'; reason?: string; additionalContext?: string } | void => {
      if (!cfg.enabled) return;
      if (input.toolResult?.isError) return;

      const inp = (input.toolInput ?? {}) as Record<string, unknown>;
      const path = inp['path'] as string | undefined;
      if (!path) return;

      const basename = path.split(/[/\\]/).pop() ?? '';
      if (
        !/^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(
          basename,
        )
      ) {
        return;
      }

      return {
        additionalContext: `Manifest file ${basename} changed. Consider running migration_plan if a dependency version was updated.`,
      };
    };

    state.hookUnregister = api.registerHook('PostToolUse', 'write|edit', hook);

    // --- migration_plan ---
    api.tools.register({
      name: 'migration_plan',
      description:
        'Read a package CHANGELOG and produce a migration checklist with breaking changes and recommended steps between two versions.',
      inputSchema: {
        type: 'object',
        properties: {
          packageName: {
            type: 'string',
            description: 'Name of the npm package or framework.',
          },
          fromVersion: {
            type: 'string',
            description: 'Current version, e.g. "1.2.3".',
          },
          toVersion: {
            type: 'string',
            description: 'Target version, e.g. "2.0.0".',
          },
          scope: {
            type: 'string',
            description: 'Optional scope describing which parts of the project use the package.',
          },
        },
        required: ['packageName', 'fromVersion', 'toVersion'],
      },
      permission: 'auto',
      category: 'Planning',
      mutating: false,
      async execute(input: {
        packageName: string;
        fromVersion: string;
        toVersion: string;
        scope?: string | undefined;
      }) {
        if (!cfg.enabled) return { ok: false, error: 'migration-planner is disabled' };

        const packageName = String(input.packageName ?? '').trim();
        const fromVersion = String(input.fromVersion ?? '').trim();
        const toVersion = String(input.toVersion ?? '').trim();
        if (!packageName || !fromVersion || !toVersion) {
          return { ok: false, error: 'packageName, fromVersion, and toVersion are required' };
        }

        const changelog = readChangelog(packageName, cfg);
        let breakingChanges: string[];
        let recommendedSteps: string[];
        let source: string | null;

        if (changelog) {
          source = changelog.source;
          const sections = extractVersionSections(changelog.content, fromVersion, toVersion);
          const combined = sections.join('\n\n');
          breakingChanges = extractBreakingChanges(combined);
          recommendedSteps = extractRecommendedSteps(combined);
        } else {
          state.fallbackCount += 1;
          source = null;
          const guide = buildGenericGuide(packageName, fromVersion, toVersion, input.scope);
          breakingChanges = guide.breakingChanges;
          recommendedSteps = guide.recommendedSteps;
        }

        state.plansGenerated += 1;
        state.lastPlan = {
          packageName,
          fromVersion,
          toVersion,
          scope: input.scope,
          breakingChanges,
          recommendedSteps,
          changelogSource: source,
        };

        return {
          ok: true,
          packageName,
          fromVersion,
          toVersion,
          scope: input.scope,
          changelogSource: source,
          fallback: source === null,
          breakingChanges,
          recommendedSteps,
        };
      },
    });

    // --- migration_status ---
    api.tools.register({
      name: 'migration_status',
      description: 'Reports migration-planner state: counters, config, and last plan.',
      inputSchema: { type: 'object', properties: {} },
      permission: 'auto',
      category: 'Diagnostics',
      mutating: false,
      async execute() {
        state.statusQueries += 1;
        return {
          ok: true,
          enabled: cfg.enabled,
          changelogPaths: cfg.changelogPaths,
          maxChars: cfg.maxChars,
          counters: {
            plansGenerated: state.plansGenerated,
            statusQueries: state.statusQueries,
            fallbackCount: state.fallbackCount,
          },
          lastPlan: state.lastPlan,
        };
      },
    });

    api.log.info('migration-planner plugin loaded', {
      version: '0.1.0',
      changelogPaths: cfg.changelogPaths,
    });
  },

  teardown(api) {
    if (state.hookUnregister) {
      try {
        state.hookUnregister();
      } catch {
        // best-effort
      }
      state.hookUnregister = null;
    }
    const final = {
      plansGenerated: state.plansGenerated,
      statusQueries: state.statusQueries,
      fallbackCount: state.fallbackCount,
    };
    state.plansGenerated = 0;
    state.statusQueries = 0;
    state.fallbackCount = 0;
    state.lastPlan = null;
    api.log.info('migration-planner: teardown complete', { final });
  },

  async health() {
    return {
      ok: true,
      message: `migration-planner: ${state.plansGenerated} plan(s), ${state.fallbackCount} fallback(s)`,
      counters: {
        plansGenerated: state.plansGenerated,
        statusQueries: state.statusQueries,
        fallbackCount: state.fallbackCount,
      },
      lastPlan: state.lastPlan,
    };
  },
};

export default plugin;
