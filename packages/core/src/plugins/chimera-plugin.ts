import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { EventBus } from '../kernel/events.js';
import type { Plugin } from '../types/plugin.js';
import type { SlashCommand } from '../types/slash-command.js';
import { buildReviewContext } from './review-context-builder.js';
import { toErrorMessage } from '../utils/error.js';
import { readBundledInstructionText } from '../utils/instruction-file.js';

// ---------------------------------------------------------------------------
// Chimera configuration — read from config.extensions['wstack-chimera']
// ---------------------------------------------------------------------------
interface ChimeraConfig {
  enabled?: boolean | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  maxFiles?: number | undefined;
  /**
   * How to handle chimera review findings:
   * - `off` (default): Send result to mailbox; leader waits for user command.
   * - `ask`: Send ask to mailbox; leader prompts user for permission.
   * - `auto`: Spawn a fix subagent automatically with the review report.
   */
  autoFix?: 'off' | 'ask' | 'auto' | undefined;
  /**
   * Cascade severity threshold for follow-up agents. When the post-session
   * review finds findings at or above this level, security-scanner and/or
   * bug-hunter agents are spawned to investigate and fix. Mirrors the
   * auto-review plugin's cascadeOn. Default: "off" (no cascade).
   */
  cascadeOn?: 'off' | 'critical' | 'high' | undefined;
  /**
   * Maximum cascade fix→re-review cycles before the self-correcting loop
   * stops. Default: 2. 0 disables re-review (fix agents run once, no
   * re-check). Mirrors the auto-review plugin's maxCascadeDepth.
   */
  maxCascadeDepth?: number | undefined;
  /**
   * @deprecated Removed. The subagent's `Request.maxTokens` now defaults to
   * the provider's `capabilities.maxOutput`, so Chimera reports can run up
   * to the selected model's native ceiling. Kept on the config interface as an `unknown` sink
   * so old config files don't crash — but it's no longer read.
   */
  maxTokens?: unknown;
}

export interface ResolvedChimeraConfig {
  enabled: boolean;
  provider: string;
  model: string;
  maxFiles: number;
  autoFix: 'off' | 'ask' | 'auto';
  cascadeOn: 'off' | 'critical' | 'high';
  maxCascadeDepth: number;
}

const DEFAULT_MAX_FILES = 15;
const DEFAULT_CASCADE_ON = 'off' as const;
const DEFAULT_MAX_CASCADE_DEPTH = 2;

export function resolveChimeraConfig(
  cfg: ChimeraConfig,
  sessionProvider: string,
  sessionModel: string,
): ResolvedChimeraConfig {
  return {
    enabled: cfg.enabled !== false,
    provider: cfg.provider ?? sessionProvider,
    model: cfg.model ?? sessionModel,
    maxFiles: cfg.maxFiles ?? DEFAULT_MAX_FILES,
    autoFix: cfg.autoFix ?? 'off',
    cascadeOn: cfg.cascadeOn ?? DEFAULT_CASCADE_ON,
    maxCascadeDepth: cfg.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH,
  };
}

// ---------------------------------------------------------------------------
// Event payload emitted on session.ended when chimera is enabled
// ---------------------------------------------------------------------------

/**
 * A single changed file with its content and, for modified files, a
 * unified diff against HEAD so the reviewer can focus on what changed.
 */
export interface ReviewFileEntry {
  path: string;
  status: 'added' | 'modified';
  content: string;
  /**
   * Unified diff against HEAD for modified files.
   * For added files, this is undefined (content is the full file).
   * Capped at a reasonable size to avoid bloating the subagent task.
   */
  diff?: string | undefined;
}

/**
 * Context bundle that enriches a review beyond "here are N files."
 * Collects the *story*: what task motivated the change, what else
 * changed alongside it, and what the recent commit history looks like.
 *
 * The review subagent receives this so it can:
 * - Focus on the diff (what changed) rather than re-reviewing unchanged code
 * - Understand the task intent (todos, narrative) to judge correctness
 * - See sibling changes for cross-file consistency
 * - Avoid re-reporting known issues (commit history context)
 */
export interface ReviewContextBundle {
  /** Resolved chimera config */
  config: ResolvedChimeraConfig;
  /** Project root for git operations */
  cwd: string;
  /** Changed files with their contents and diffs */
  files: ReviewFileEntry[];
  /**
   * Cascade severity threshold from the auto-review plugin config.
   * When the review subagent finds findings at or above this level, a
   * follow-up agent (security-scanner, bug-hunter) is spawned to
   * investigate. Set by the auto-review plugin when it builds the
   * bundle; absent for chimera-plugin and /review triggers (no cascade).
   *
   * `'off'` disables cascading; `'high'` cascades on High+; `'critical'`
   * cascades only on Critical.
   */
  cascadeOn?: 'off' | 'critical' | 'high' | undefined;
  /**
   * Current cascade iteration depth (0 for the initial review, 1 after
   * the first fix+re-review cycle, etc.). The cascade handler increments
   * this on each re-review emission and stops when it reaches
   * `maxCascadeDepth`. Absent (treated as 0) for non-cascade triggers.
   */
  cascadeDepth?: number | undefined;
  /**
   * Maximum cascade iterations before the self-correcting loop stops.
   * Prevents infinite fix → re-review → fix cycles. Default 2. Set by
   * the auto-review plugin; absent for non-cascade triggers.
   */
  maxCascadeDepth?: number | undefined;

  // ── Sibling awareness ──
  /**
   * All files changed in the working tree, including ones not in the
   * current review batch. Lets the reviewer understand the broader
   * change set without expanding its review scope.
   */
  allChangedFiles?: Array<{ path: string; status: string }> | undefined;

  // ── Commit history ──
  /**
   * Recent commit messages (oneline), newest first.
   * Helps the reviewer understand what was already committed vs.
   * what's still uncommitted working-tree changes.
   */
  recentCommits?: string[] | undefined;

  // ── Task & intent context (P1) ──
  /**
   * Active todo items from the session Context at review-trigger time.
   * Lets the reviewer understand what task motivated the file changes
   * so it can judge correctness against intent, not just code shape.
   */
  activeTodos?: Array<{ id: string; content: string; status: string }> | undefined;

  /**
   * The active kanban card, if the session uses a kanban board.
   * Provides title, description, and success criteria so the
   * reviewer can verify the change satisfies the stated requirements.
   */
  kanbanCard?:
    | {
        id: string;
        title: string;
        description?: string | undefined;
        successCriteria?: string[] | undefined;
      }
    | undefined;

  /**
   * File provenance from the Chronicle journal: which agent/session/task
   * last touched each file and when. Helps the reviewer attribute
   * changes and understand the broader edit chain.
   */
  fileProvenance?:
    | Array<{
        path: string;
        agentId?: string | undefined;
        taskId?: string | undefined;
        eventType?: string | undefined;
        observedAt?: string | undefined;
      }>
    | undefined;
}

/** Legacy alias — the payload type is the bundle type. */
export type ChimeraReviewNeededPayload = ReviewContextBundle;

/**
 * Payload emitted as `chimera.review_complete` after the review subagent
 * finishes (success or failure). Consumed by the auto-review plugin's
 * cascade listener to parse severity and decide whether to emit
 * `chimera.cascade_needed`.
 */
export interface ChimeraReviewCompletePayload {
  /** The original review context bundle that triggered this review. */
  bundle: ReviewContextBundle;
  /** The review report text the subagent produced (empty on failure). */
  reviewText: string;
  /** Whether the subagent succeeded (`'success'`) or failed otherwise. */
  status: string;
  /** Project root. */
  cwd: string;
}

/**
 * Payload emitted as `chimera.cascade_needed` when a review report
 * contains findings at or above the configured `cascadeOn` threshold.
 * Consumed by execution.ts to spawn follow-up investigation agents.
 */
export interface ChimeraCascadeNeededPayload {
  /** The original review context bundle (carries cwd + files). */
  bundle: ReviewContextBundle;
  /** The review report text that triggered the cascade. */
  reviewText: string;
  /** The parsed severity counts that crossed the threshold. */
  severities: { critical: number; high: number; medium: number };
  /** The threshold that was crossed (`'high'` or `'critical'`). */
  threshold: 'high' | 'critical';
  /** Follow-up agent roles to spawn, derived from the finding types. */
  agents: CascadeAgentKind[];
}

/**
 * Follow-up cascade agent kinds. Each maps to a roster role and a
 * tailored task description. Multiple may be spawned in parallel when
 * a review surfaces both security and correctness concerns.
 */
export type CascadeAgentKind = 'security-scanner' | 'bug-hunter';

// ---------------------------------------------------------------------------
// System prompt for the subagent (matches packages/core/skills/chimera/SKILL.md)
// ---------------------------------------------------------------------------
export const CHIMERA_REVIEW_PROMPT = readBundledInstructionText('llm/chimera-review.md');

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
      // `spawn` throws synchronously when the binary is not found (e.g.,
      // git not installed on Windows). Reject the promise so callers can
      // handle it gracefully instead of surfacing as an unhandled rejection.
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
// Slash command
// ---------------------------------------------------------------------------
function buildChimeraCommand(
  getConfig: () => ResolvedChimeraConfig,
  events: EventBus,
): SlashCommand {
  return {
    name: 'chimera',
    category: 'Session',
    description: 'Show Chimera post-session review agent status and configuration.',
    help: [
      '╔═══ Chimera ═══╗',
      '',
      'Post-session code quality guardian. Reviews files changed during',
      'each session using a dedicated subagent with full tool access.',
      '',
      'Commands:',
      '  /chimera          Show current status',
      '  /review           Manually review changed files now',
      '',
      'Configuration (edit config.json):',
      '  extensions.wstack-chimera.enabled    true | false',
      '  extensions.wstack-chimera.provider   provider id',
      '  extensions.wstack-chimera.model      model id',
      '  extensions.wstack-chimera.maxFiles   max files (default 15)',
      '  extensions.wstack-chimera.autoFix    off | ask | auto (default off)',
      '  extensions.wstack-chimera.cascadeOn  off | critical | high (default off)',
      '  extensions.wstack-chimera.maxCascadeDepth  max fix+re-review cycles (default 2)',
      '',
      'Output cap: the subagent runs up to the provider\'s model-native',
      'output ceiling (Anthropic 64K, OpenAI 16K, Gemini 8K). No manual cap.',
    ].join('\n'),
    async run(args) {
      const cfg = getConfig();
      const trimmed = (args ?? '').trim();

      // Subcommand: /chimera autoFix <off|ask|auto>
      if (trimmed.startsWith('autoFix') || trimmed.startsWith('autofix')) {
        const mode = trimmed.split(/\s+/)[1]?.toLowerCase();
        if (!mode || !['off', 'ask', 'auto'].includes(mode)) {
          return {
            message: [
              `Usage: /chimera autoFix <off|ask|auto>`,
              `Current: ${cfg.autoFix}`,
              '',
              '  off  — send review result to mailbox; leader waits for your command.',
              '  ask  — send review as an ask; leader prompts you for permission.',
              '  auto — send review result AND spawn a fix subagent automatically.',
            ].join('\n'),
          };
        }
        // Emit a custom event so the execution layer can update agent.ctx.meta in real time.
        (events as never as { emit: (name: string, payload: { mode: string }) => void }).emit('chimera.set_autofix', { mode });
        return {
          message: `✅ Chimera autoFix set to "${mode}" for this session (config file unchanged).`,
        };
      }

      return {
        message: [
          `🦂 Chimera — ${cfg.enabled ? 'enabled' : 'disabled'}`,
          '',
          `  Provider:   ${cfg.provider}`,
          `  Model:      ${cfg.model}`,
          `  Max files:  ${cfg.maxFiles}`,
          `  Auto-fix:   ${cfg.autoFix}`,
          `  Cascade:    ${cfg.cascadeOn === 'off' ? 'disabled' : `on ${cfg.cascadeOn}+ → spawns security-scanner/bug-hunter`}`,
          `  Max depth:  ${cfg.maxCascadeDepth} re-review cycle(s)`,
          `  Max output: model-native (no cap)`,
          '',
          cfg.enabled
            ? 'Auto-review runs after each session. /review triggers manually.'
            : 'Set extensions.wstack-chimera.enabled = true to enable.',
        ].join('\n'),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export function createChimeraPlugin(): Plugin {
  return {
    name: 'wstack-chimera',
    version: '1.0.0',
    description: 'Post-session code quality guardian with subagent review.',
    apiVersion: '^0.1',
    capabilities: { slashCommands: true },
    defaultConfig: {},

    setup(api) {
      // ── Reactive config ──────────────────────────────────────────
      const recompute = (): ResolvedChimeraConfig => {
        const raw: ChimeraConfig =
          (api.config.extensions?.['wstack-chimera'] as ChimeraConfig | undefined) ?? {};
        return resolveChimeraConfig(raw, api.config.provider, api.config.model);
      };
      let resolved = recompute();

      api.onConfigChange(() => {
        const old = resolved;
        resolved = recompute();
        if (old.enabled !== resolved.enabled || old.provider !== resolved.provider || old.model !== resolved.model) {
          api.log.info(
            `[chimera] config changed — enabled=${resolved.enabled} provider=${resolved.provider} model=${resolved.model}`,
          );
        }
      });

      if (!resolved.enabled) {
        api.log.info('[chimera] disabled by config');
        return;
      }

      api.log.info(
        `[chimera] loaded — provider=${resolved.provider} model=${resolved.model} maxFiles=${resolved.maxFiles}`,
      );

      // ── /chimera command ──────────────────────────────────────────
      api.slashCommands.register(buildChimeraCommand(() => resolved, api.events));

      // ── session.ended → emit review event ─────────────────────────
      api.onEvent('session.ended', async () => {
        try {
        const cfg = resolved;
        if (!cfg.enabled) return;

        const cwd = api.config.cwd ?? process.cwd();
        if (!(await isGitRepo(cwd))) {
          api.log.info('[chimera] skipped — not a git repo');
          return;
        }

        const allChanged = await getChangedFiles(cwd);
        const existing: ChangedFile[] = [];
        for (const f of allChanged) {
          if (f.path.startsWith('.wrongstack/')) continue;
          try { await fsp.access(path.join(cwd, f.path)); existing.push(f); } catch { /* deleted */ }
        }

        if (existing.length === 0) {
          api.log.info('[chimera] no changed files to review');
          return;
        }

        const toReview = existing.slice(0, cfg.maxFiles);
        if (existing.length > cfg.maxFiles) {
          api.log.info(`[chimera] capping review at ${cfg.maxFiles} of ${existing.length} files`);
        }

        // Read file contents
        const filesWithContent: ReviewFileEntry[] = [];
        for (const f of toReview) {
          try {
            const absPath = path.join(cwd, f.path);
            const content = await fsp.readFile(absPath, 'utf8');
            filesWithContent.push({ path: f.path, status: f.status, content });
          } catch { /* skip */ }
        }

        if (filesWithContent.length === 0) {
          api.log.info('[chimera] could not read changed files');
          return;
        }

        // ── Build enriched review context (diffs, siblings, commits) ──
        const bundle = await buildReviewContext({
          cwd,
          config: cfg,
          files: filesWithContent,
          cascadeOn: cfg.cascadeOn,
          maxCascadeDepth: cfg.maxCascadeDepth,
        });

        // Emit custom event — execution.ts picks this up and spawns the subagent
        api.emitCustom('chimera.review_needed', bundle satisfies ReviewContextBundle);

        api.log.info(`[chimera] emitted review_needed event (${filesWithContent.length} files)`);
        } catch (err) {
          api.log.warn(`[chimera] session.ended handler failed: ${toErrorMessage(err)}`);
        }
      });
    },

    teardown(api) {
      api.slashCommands.unregister('chimera');
      api.log.info('[chimera] unloaded');
    },

    async health() {
      return { ok: true, message: 'chimera ready' };
    },
  };
}
