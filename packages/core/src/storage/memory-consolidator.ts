import type { RunResult } from '../core/agent-types.js';
import type { Context } from '../core/context.js';
import type { AfterRunHook, AgentExtension } from '../extension/extension-points.js';
import type { MemoryEntry, MemoryStore } from '../types/memory.js';
import type { Provider } from '../types/provider.js';
import type { OneShotOrchestrator } from '../execution/one-shot-llm.js';
import {
  readBundledInstructionText,
  renderInstructionTemplate,
} from '../utils/instruction-file.js';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Minimal interface for writing to Super Memory without importing
 * @wrongstack/super-memory (core cannot depend on super-memory).
 * Tools like the consolidator use this to route adds through
 * rememberSuper rather than the legacy MemoryStore.remember(),
 * making them visible to searchSuper/turn-middleware.
 */
type ConsolidatorSuperMemoryKind =
  | 'fact'
  | 'decision'
  | 'convention'
  | 'preference'
  | 'anti_pattern'
  | 'file_note';

interface ConsolidatorSuperMemoryRecord {
  text: string;
  scope?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface ConsolidatorSuperMemory {
  rememberSuper(input: {
    text: string;
    scope?: string | undefined;
    kind?: ConsolidatorSuperMemoryKind | undefined;
    tags?: string[] | undefined;
    priority?: string | undefined;
    importance?: number | undefined;
    confidence?: number | undefined;
    sources?: Array<{ type: string; sessionId?: string | undefined }> | undefined;
  }): Promise<unknown>;
  listSuper?(statuses?: Array<'active'>): Promise<unknown[]>;
  searchSuper?(
    query: string,
    opts?: { limit?: number; scope?: 'project'; includeStatuses?: Array<'active'> },
  ): Promise<unknown[]>;
}

function isSuperMemoryRecord(value: unknown): value is ConsolidatorSuperMemoryRecord {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { text?: unknown }).text === 'string';
}

function toPromptEntries(records: unknown[], limit: number): MemoryEntry[] {
  return records
    .filter(isSuperMemoryRecord)
    .filter((record) => record.scope === 'project')
    .slice(0, limit)
    .map((record) => ({
      scope: 'project-memory',
      text: record.text,
      ts: record.updatedAt ?? record.createdAt ?? '',
    }));
}

function toSuperMemoryKind(type: string | undefined): ConsolidatorSuperMemoryKind {
  switch (type) {
    case 'decision':
    case 'convention':
    case 'preference':
    case 'anti_pattern':
      return type;
    case 'reference':
      return 'file_note';
    default:
      return 'fact';
  }
}

function importanceFromPriority(priority: string | undefined): number {
  switch (priority) {
    case 'critical':
      return 0.95;
    case 'high':
      return 0.8;
    case 'medium':
      return 0.55;
    case 'low':
      return 0.25;
    default:
      return 0.6;
  }
}

export interface ConsolidationOp {
  /**
   * Add-only by design. The consolidator runs unattended after every
   * successful session, so LLM-issued delete/edit ops used to give an
   * unsupervised model a substring-matched deletion path over the whole
   * memory store (see the 2026-07 mass-deletion postmortem). Removals and
   * corrections belong to explicit review flows (memory_delete /
   * memory_update / ReviewQueue), never to this hook.
   */
  action: 'add';
  /** The fact to remember. */
  text?: string | undefined;
  /** Memory type for categorization. */
  type?: string | undefined;
  /** Tags for grouping. */
  tags?: string[] | undefined;
  /** Priority level. */
  priority?: string | undefined;
}

interface ConsolidationResponse {
  operations: ConsolidationOp[];
  summary?: string | undefined;
}

export interface MemoryConsolidatorOptions {
  memoryStore: MemoryStore;
  /**
   * Optional Super Memory writer. When provided, the consolidator routes
   * adds through `rememberSuper()` and reads existing entries for dedup
   * context via `searchSuper()` instead of the legacy `MemoryStore`.
   * This makes consolidator-sourced memories visible to the turn-middleware
   * (searchSuper, retrieveForPath) which only queries Super Memory.
   */
  superMemory?: ConsolidatorSuperMemory | undefined;
  /**
   * Provider used for the consolidation LLM call. Uses the session's
   * provider by default.
   */
  provider?: Provider | undefined;
  /**
   * Model override for the consolidation call. Uses the session's model
   * by default. A smaller/faster model is recommended (e.g. deepseek-chat, haiku, flash).
   */
  model?: string | undefined;
  /**
   * Minimum session iterations before consolidation fires.
   * Sessions shorter than this are skipped (default 2).
   */
  minIterations?: number | undefined;
  /**
   * Maximum memory entries to include in the prompt as context.
   */
  maxExistingEntries?: number | undefined;
  /**
   * OneShotOrchestrator for the consolidation LLM call. When set, uses
   * it instead of the direct provider.complete() path, gaining fallback
   * chain support and cheap-model defaulting.
   */
  oneShotOrchestrator?: OneShotOrchestrator | undefined;
}

// ── Prompt ──────────────────────────────────────────────────────────────

function buildConsolidationPrompt(
  finalText: string,
  iterations: number,
  existingEntries: MemoryEntry[],
): string {
  const existingBlock =
    existingEntries.length > 0
      ? `\n\nExisting memory entries:\n${existingEntries
          .map((e) => `- [${e.ts.slice(0, 10)}] ${e.text}`)
          .join('\n')}`
      : '';

  return renderInstructionTemplate(readBundledInstructionText('llm/memory-consolidator.md'), {
    iterations: String(iterations),
    summary: finalText.slice(0, 3000),
    existingEntries: existingBlock,
  });
}

// ── Consolidator ────────────────────────────────────────────────────────

export class SessionMemoryConsolidator implements AgentExtension {
  name = 'session-memory-consolidator';
  owner = 'core';

  private readonly memoryStore: MemoryStore;
  private readonly superMemory?: ConsolidatorSuperMemory | undefined;
  private readonly provider?: Provider | undefined;
  private readonly model?: string | undefined;
  private readonly minIterations: number;
  private readonly maxExistingEntries: number;
  private readonly oneShotOrchestrator?: OneShotOrchestrator | undefined;

  constructor(opts: MemoryConsolidatorOptions) {
    this.memoryStore = opts.memoryStore;
    this.superMemory = opts.superMemory;
    this.provider = opts.provider;
    this.model = opts.model;
    this.minIterations = opts.minIterations ?? 2;
    this.maxExistingEntries = opts.maxExistingEntries ?? 15;
    this.oneShotOrchestrator = opts.oneShotOrchestrator;
  }

  afterRun: AfterRunHook = (ctx: Context, result: RunResult) => {
    // Only consolidate successful sessions with meaningful output
    if (result.status !== 'done') return;
    if (!result.finalText || result.finalText.trim().length < 20) return;
    if (result.iterations < this.minIterations) return;

    const provider = this.provider ?? ctx.provider;
    if (!provider?.complete) return;

    // Capture narrowed values for the fire-and-forget closure.
    const _finalText: string = result.finalText;
    const _iterations: number = result.iterations;
    const _model: string | undefined = this.model ?? ctx.model;
    const _sessionId: string = ctx.session.id;

    // Fire-and-forget: consolidation is best-effort and should never block
    // session teardown (the LLM call can take up to 15s). The catch block
    // below prevents unhandled rejections.
    void (async () => {
      try {
        // Load existing memory through the same backend contract used for writes.
        // SQLite-shaped Super Memory stores intentionally do not implement the
        // legacy MemoryStore.list() interface.
        let existingEntries: MemoryEntry[];
        if (this.superMemory) {
          const records = this.superMemory.listSuper
            ? await this.superMemory.listSuper(['active'])
            : await this.superMemory.searchSuper?.('', {
                limit: this.maxExistingEntries,
                scope: 'project',
                includeStatuses: ['active'],
              }) ?? [];
          existingEntries = toPromptEntries(records, this.maxExistingEntries);
        } else {
          existingEntries = await this.memoryStore.list('project-memory', this.maxExistingEntries);
        }
        const prompt = buildConsolidationPrompt(
          _finalText,
          _iterations,
          existingEntries,
        );

        // Call the LLM with a focused, one-shot prompt
        let text: string;
        if (this.oneShotOrchestrator) {
          const oneShotResult = await this.oneShotOrchestrator.call({
            system: prompt,
            userPrompt: 'Review the session and return memory operations as JSON.',
            model: _model ?? 'deepseek-chat',
            maxTokens: 500,
            timeoutMs: 15_000,
          });
          text = oneShotResult.text;
        } else {
          // Legacy path: direct provider.complete()
          const signal = AbortSignal.timeout(15_000);
          const response = await provider.complete(
            {
              model: _model,
              system: [{ type: 'text', text: prompt }],
              messages: [
                { role: 'user', content: 'Review the session and return memory operations as JSON.' },
              ],
              maxTokens: 500,
            },
            { signal },
          );
          text = response.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
        }
        if (!text) return;

        // Extract JSON from possible markdown wrapper
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const parsed: ConsolidationResponse = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) return;

        // Apply operations (add-only: anything else the model emits is ignored)
        let added = 0;

        for (const op of parsed.operations) {
          try {
            if (!op || typeof op !== 'object' || op.action !== 'add') continue;
            if (typeof op.text !== 'string' || !op.text.trim()) continue;
            const memoryText = op.text.trim();

            if (this.superMemory) {
              // Translate the legacy prompt enum before crossing the Super
              // Memory boundary; reference is represented as file_note there.
              await this.superMemory.rememberSuper({
                text: memoryText,
                scope: 'project',
                kind: toSuperMemoryKind(op.type),
                tags: op.tags,
                importance: importanceFromPriority(op.priority),
                sources: [{ type: 'session', sessionId: _sessionId }],
              });
            } else {
              // Legacy path: write to the markdown-based MemoryStore.
              await this.memoryStore.remember(memoryText, undefined, {
                type: op.type as MemoryEntry['type'],
                tags: op.tags,
                priority: op.priority as MemoryEntry['priority'],
              });
            }
            added++;
          } catch {
            // One malformed or backend-rejected item must not discard later
            // valid additions from the same consolidation batch.
          }
        }

        if (added > 0) {
          // Log to stderr so it surfaces in the terminal
          process.stderr.write(`[memory] Session consolidation: ${added} added\n`);
        }
      } catch {
        // Silent — memory consolidation is best-effort, never blocks session cleanup
      }
    })();
  };
}
