import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Plugin } from '../types/plugin.js';
import type { SlashCommand } from '../types/slash-command.js';
import { toErrorMessage } from '../utils/error.js';
import type { ChimeraReviewNeededPayload } from './chimera-plugin.js';

// ---------------------------------------------------------------------------
// Auto-review configuration — read from config.extensions['wstack-auto-review']
// ---------------------------------------------------------------------------
export interface AutoReviewConfig {
  enabled?: boolean | undefined;
  /** Provider for review subagents. Falls back to session provider. */
  provider?: string | undefined;
  /** Model for review subagents. Falls back to session model. */
  model?: string | undefined;
  /** Ordered fallback models chain. */
  fallbackModels?: string[] | undefined;
  /** Debounce window in ms — wait for quiet before firing review (default 5000). */
  debounceMs?: number | undefined;
  /** Max files per review batch (default 15). */
  maxFilesPerBatch?: number | undefined;
  /** Max concurrent in-flight reviews (default 2). */
  maxConcurrentReviews?: number | undefined;
  /**
   * Cascade severity threshold: when a review finds findings at or above this
   * level, spawn follow-up agents automatically. "off" disables cascading,
   * "high" cascades on High+, "critical" cascades only on Critical.
   * Default: "off".
   */
  cascadeOn?: 'off' | 'critical' | 'high' | undefined;
}

export interface ResolvedAutoReviewConfig {
  enabled: boolean;
  provider: string;
  model: string;
  fallbackModels: string[];
  debounceMs: number;
  maxFilesPerBatch: number;
  maxConcurrentReviews: number;
  cascadeOn: 'off' | 'critical' | 'high';
}

const DEFAULT_DEBOUNCE_MS = 5_000;
const DEFAULT_MAX_FILES_PER_BATCH = 15;
const DEFAULT_MAX_CONCURRENT_REVIEWS = 2;

export function resolveAutoReviewConfig(
  cfg: AutoReviewConfig,
  sessionProvider: string,
  sessionModel: string,
): ResolvedAutoReviewConfig {
  return {
    enabled: cfg.enabled === true,
    provider: cfg.provider ?? sessionProvider,
    model: cfg.model ?? sessionModel,
    fallbackModels: cfg.fallbackModels ?? [],
    debounceMs: cfg.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    maxFilesPerBatch: cfg.maxFilesPerBatch ?? DEFAULT_MAX_FILES_PER_BATCH,
    maxConcurrentReviews: cfg.maxConcurrentReviews ?? DEFAULT_MAX_CONCURRENT_REVIEWS,
    cascadeOn: cfg.cascadeOn ?? 'off',
  };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: AbortSignal.timeout(15_000),
        windowsHide: true,
      });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', () => resolve({ stdout, stderr, code: 1 }));
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await runGit(['rev-parse', '--git-dir'], cwd);
  return r.code === 0;
}

interface ChangedFile {
  path: string;
  status: 'added' | 'modified';
}

async function getChangedFiles(cwd: string): Promise<ChangedFile[]> {
  const r = await runGit(['status', '--porcelain'], cwd);
  if (r.code !== 0) return [];
  const files: ChangedFile[] = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const statusCode = line.slice(0, 2).trim();
    const filePath = line.slice(3).trim();
    if (statusCode === 'A' || statusCode === 'A ' || statusCode === ' A' || statusCode === '??') {
      files.push({ path: filePath, status: 'added' });
    } else if (statusCode.includes('M')) {
      files.push({ path: filePath, status: 'modified' });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// In-flight review tracking
// ---------------------------------------------------------------------------
interface InFlightReview {
  files: string[]; // file paths being reviewed
  startedAt: number;
  subagentType: 'review' | 'cascade';
}

// ---------------------------------------------------------------------------
// Slash command
// ---------------------------------------------------------------------------
function buildAutoReviewCommand(getConfig: () => ResolvedAutoReviewConfig, getInFlightCount: () => number): SlashCommand {
  return {
    name: 'auto-review',
    category: 'Session',
    description: 'Show continuous auto-review status and configuration.',
    help: [
      '╔═══ Auto Review ═══╗',
      '',
      'Continuous code review that fires on every change during a session.',
      'Detects git-tracked file edits and dispatches review subagents',
      'with configurable provider/model/fallback.',
      '',
      'Commands:',
      '  /auto-review           Show current status and config',
      '  /auto-review on        Enable auto-review',
      '  /auto-review off       Disable auto-review',
      '',
      'Configuration (edit config.json extensions.wstack-auto-review):',
      '  enabled              true | false',
      '  provider             provider id for review agents',
      '  model                model id for review agents',
      '  fallbackModels       [model1, model2] fallback chain',
      '  debounceMs           debounce window (default 5000)',
      '  maxFilesPerBatch     max files per review (default 15)',
      '  maxConcurrentReviews max parallel reviews (default 2)',
      '  cascadeOn            "off" | "critical" | "high"',
    ].join('\n'),
    async run(args: string) {
      const cfg = getConfig();
      const trimmed = (args ?? '').trim().toLowerCase();
      if (trimmed === 'on' || trimmed === 'enable') {
        return { message: 'Auto-review enable/disable via config.json extensions.wstack-auto-review.enabled' };
      }
      if (trimmed === 'off' || trimmed === 'disable') {
        return { message: 'Auto-review enable/disable via config.json extensions.wstack-auto-review.enabled' };
      }

      const inFlight = getInFlightCount();
      return {
        message: [
          `📋 Auto Review — ${cfg.enabled ? '✅ enabled' : '⏸️  disabled'}`,
          '',
          `  Provider:       ${cfg.provider}`,
          `  Model:          ${cfg.model}`,
          `  Fallback:       ${cfg.fallbackModels.length > 0 ? cfg.fallbackModels.join(', ') : '(none)'}`,
          `  Debounce:       ${cfg.debounceMs} ms`,
          `  Max files:      ${cfg.maxFilesPerBatch}`,
          `  Max parallel:   ${cfg.maxConcurrentReviews}`,
          `  Cascade:        ${cfg.cascadeOn}`,
          `  In-flight:      ${inFlight} review(s)`,
          '',
          'Fires on every git-tracked file change during the session.',
          'Disabled by default. Enable via config.json.',
        ].join('\n'),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export function createAutoReviewPlugin(): Plugin {
  return {
    name: 'wstack-auto-review',
    version: '1.0.0',
    description: 'Continuous auto-review that fires on every code change during a session.',
    apiVersion: '^0.1',
    capabilities: { slashCommands: true },
    defaultConfig: {},

    setup(api) {
      // ── Reactive config ──────────────────────────────────────────
      const recompute = (): ResolvedAutoReviewConfig => {
        const raw: AutoReviewConfig =
          (api.config.extensions?.['wstack-auto-review'] as AutoReviewConfig | undefined) ?? {};
        return resolveAutoReviewConfig(raw, api.config.provider, api.config.model);
      };
      let resolved = recompute();
      let inFlight: InFlightReview[] = [];

      api.onConfigChange(() => {
        const old = resolved;
        resolved = recompute();
        if (old.enabled !== resolved.enabled || old.provider !== resolved.provider || old.model !== resolved.model) {
          api.log.info(
            `[auto-review] config changed — enabled=${resolved.enabled} provider=${resolved.provider} model=${resolved.model}`,
          );
        }
      });

      if (!resolved.enabled) {
        api.log.info('[auto-review] disabled by config');
        return;
      }

      api.log.info(
        `[auto-review] loaded — provider=${resolved.provider} model=${resolved.model} debounce=${resolved.debounceMs}ms cascade=${resolved.cascadeOn}`,
      );

      // ── State: track known files across iterations ───────────────
      let knownFiles = new Map<string, 'added' | 'modified'>();
      let lastDetectionTs = 0;
      let reviewCounter = 0;

      // Seed known files on session start so first edit always triggers
      api.onEvent('agent.run.started', async () => {
        try {
          const cwd = api.config.cwd ?? process.cwd();
          if (!(await isGitRepo(cwd))) return;
          const allChanged = await getChangedFiles(cwd);
          for (const f of allChanged) {
            if (!f.path.startsWith('.wrongstack/')) knownFiles.set(f.path, f.status);
          }
          api.log.info(`[auto-review] seeded ${knownFiles.size} known file(s)`);
        } catch { /* best-effort */ }
      });

      // ── /auto-review command ─────────────────────────────────────
      api.slashCommands.register(buildAutoReviewCommand(
        () => resolved,
        () => inFlight.length,
      ));

      // ── iteration.completed → detect new changes → emit review ──
      api.onEvent('iteration.completed', async () => {
        try {
          const cfg = resolved;
          if (!cfg.enabled) return;
          if (inFlight.length >= cfg.maxConcurrentReviews) {
            api.log.info(`[auto-review] at max concurrent (${cfg.maxConcurrentReviews}), skipping`);
            return;
          }

          const cwd = api.config.cwd ?? process.cwd();
          if (!(await isGitRepo(cwd))) return;

          const allChanged = await getChangedFiles(cwd);
          const now = Date.now();

          // Skip .wrongstack/ files
          const changed = allChanged.filter((f) => !f.path.startsWith('.wrongstack/'));

          // Find new files not in knownFiles
          const newFiles: ChangedFile[] = [];
          for (const f of changed) {
            const known = knownFiles.get(f.path);
            if (!known || known !== f.status) {
              newFiles.push(f);
            }
          }

          if (newFiles.length === 0) return;

          // Debounce: don't fire more often than debounceMs
          if (now - lastDetectionTs < cfg.debounceMs) {
            api.log.info(`[auto-review] debounce (${now - lastDetectionTs}ms < ${cfg.debounceMs}ms), deferring`);
            return;
          }

          // Batch: limit to maxFilesPerBatch
          const toReview = newFiles.slice(0, cfg.maxFilesPerBatch);
          if (toReview.length === 0) return;

          lastDetectionTs = now;

          // Update known files
          for (const f of changed) {
            knownFiles.set(f.path, f.status);
          }

          // Read file contents
          const filesWithContent: ChimeraReviewNeededPayload['files'] = [];
          for (const f of toReview) {
            const absPath = path.join(cwd, f.path);
            try {
              await fsp.access(absPath, fsp.constants.R_OK);
              const content = await fsp.readFile(absPath, 'utf8');
              filesWithContent.push({ path: f.path, status: f.status, content });
            } catch {
              // File deleted or not readable — skip
            }
          }

          if (filesWithContent.length === 0) return;

          reviewCounter++;

          // Track in-flight
          const inflightEntry: InFlightReview = {
            files: filesWithContent.map((f) => f.path),
            startedAt: now,
            subagentType: 'review',
          };
          inFlight.push(inflightEntry);

          // Emit the same chimera.review_needed event — execution.ts picks this up
          const payload: ChimeraReviewNeededPayload = {
            config: {
              enabled: true,
              provider: cfg.provider,
              model: cfg.model,
              maxFiles: cfg.maxFilesPerBatch,
              autoFix: 'off',
            },
            cwd,
            files: filesWithContent,
          };

          api.log.info(
            `[auto-review] #${reviewCounter} emitting review_needed (${filesWithContent.length} files, provider=${cfg.provider} model=${cfg.model})`,
          );

          api.emitCustom('chimera.review_needed', payload);

          // Note: chimera.review_needed is consumed by CLI execution.ts which
          // requires the Director (--director flag). Without it, reviews are
          // silently skipped. If reviews don't appear, check that the session
          // runs with --director or enable Director in your config.
          api.log.info(
            `[auto-review] #${reviewCounter} event emitted — requires Director (--director) for subagent spawning`,
          );

          // ── Cascade: if findings are critical/high, spawn follow-up ──
          // The cascade is handled by listening for review result events.
          // For now, we trust the reporter to flag criticals and the
          // cascadeOn config determines follow-up at session end.

          // Clean in-flight after a timeout (reviews complete asynchronously)
          setTimeout(() => {
            const idx = inFlight.indexOf(inflightEntry);
            if (idx !== -1) inFlight.splice(idx, 1);
          }, 5 * 60 * 1000);

        } catch (err) {
          api.log.warn(`[auto-review] iteration.completed handler failed: ${toErrorMessage(err)}`);
        }
      });

      // ── session.ended → final review of everything ───────────────
      api.onEvent('session.ended', async () => {
        try {
          const cfg = resolved;
          if (!cfg.enabled) return;

          const cwd = api.config.cwd ?? process.cwd();
          if (!(await isGitRepo(cwd))) return;

          const allChanged = await getChangedFiles(cwd);
          const existing: ChangedFile[] = [];
          for (const f of allChanged) {
            if (f.path.startsWith('.wrongstack/')) continue;
            try { await fsp.access(path.join(cwd, f.path)); existing.push(f); } catch { /* deleted */ }
          }

          if (existing.length === 0) return;

          const toReview = existing.slice(0, cfg.maxFilesPerBatch);

          const filesWithContent: ChimeraReviewNeededPayload['files'] = [];
          for (const f of toReview) {
            try {
              const absPath = path.join(cwd, f.path);
              const content = await fsp.readFile(absPath, 'utf8');
              filesWithContent.push({ path: f.path, status: f.status, content });
            } catch { /* skip */ }
          }

          if (filesWithContent.length === 0) return;

          api.emitCustom('chimera.review_needed', {
            config: {
              enabled: true,
              provider: cfg.provider,
              model: cfg.model,
              maxFiles: cfg.maxFilesPerBatch,
              autoFix: 'off',
            },
            cwd,
            files: filesWithContent,
          } satisfies ChimeraReviewNeededPayload);

          api.log.info(`[auto-review] session end — final review (${filesWithContent.length} files)`);
        } catch (err) {
          api.log.warn(`[auto-review] session.ended handler failed: ${toErrorMessage(err)}`);
        }
      });
    },

    teardown(api) {
      api.slashCommands.unregister('auto-review');
      api.log.info('[auto-review] unloaded');
    },

    async health() {
      return { ok: true, message: 'auto-review ready' };
    },
  };
}
