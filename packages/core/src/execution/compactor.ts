import type { Context } from '../core/context.js';
import type { ContentBlock, ToolResultBlock } from '../types/blocks.js';
import { isTextBlock } from '../types/blocks.js';
import type { CompactReport, Compactor } from '../types/compactor.js';
import type { ContextWindowPolicy } from '../types/context-window.js';
import type { Message } from '../types/messages.js';
import {
  estimateTextTokens,
  estimateToolInputTokens,
  estimateToolResultTokens,
  estimateRequestTokens,
} from '../utils/token-estimate.js';
import { repairToolUseAdjacency } from '../utils/message-invariants.js';

export interface CompactorOptions {
  preserveK?: number | undefined;
  eliseThreshold?: number | undefined;
  estimator?: (((text: string) => number)) | undefined;
}

/**
 * Default tools config values shared across CLI and WebUI.
 * Import this instead of hardcoding to avoid cross-surface inconsistencies.
 * These mirror the values in BEHAVIOR_DEFAULTS (config-loader.ts).
 *
 * @deprecated Import from '../types/default-config.js' instead.
 *             This re-export exists for backward compatibility.
 */
export { DEFAULT_TOOLS_CONFIG, DEFAULT_CONTEXT_CONFIG, DEFAULT_AUTONOMY_CONFIG } from '../types/default-config.js';

export class HybridCompactor implements Compactor {
  private readonly preserveK: number;
  private readonly eliseThreshold: number;
  private readonly estimator: (text: string) => number;

  constructor(opts: CompactorOptions = {}) {
    this.preserveK = opts.preserveK ?? 5;
    this.eliseThreshold = opts.eliseThreshold ?? 2000;
    this.estimator = opts.estimator ?? estimateTextTokens;
  }

  async compact(ctx: Context, opts: { aggressive?: boolean | undefined } = {}): Promise<CompactReport> {
    const beforeTokens = this.estimateMessages(ctx.messages);
    const beforeFull = this.estimateFullRequest(ctx);
    const reductions: CompactReport['reductions'] = [];
    const policy = readContextWindowPolicy(ctx);
    const preserveK = policy?.preserveK ?? this.preserveK;
    const eliseThreshold = policy?.eliseThreshold ?? this.eliseThreshold;

    // Phase 1: elision
    const phase1Saved = this.eliseOldToolResults(ctx, preserveK, eliseThreshold);
    if (phase1Saved > 0) reductions.push({ phase: 'elision', saved: phase1Saved });

    // Phase 2: lossless collapse of ancient turns into a single digest.
    // Unlike the previous placeholder behavior, this preserves ALL textual
    // content (instructions, decisions, conclusions); only raw tool I/O is
    // dropped (it remains in the session log). No sub-LLM call — fully rule-based.
    let collapsedDigest: string | undefined;
    if (opts.aggressive) {
      const phase2 = this.collapseAncientTurns(ctx, preserveK);
      if (phase2.saved > 0) reductions.push({ phase: 'summary', saved: phase2.saved });
      collapsedDigest = phase2.digest;
    }

    const repaired = repairToolUseAdjacency(ctx.messages);
    if (repaired.report.changed) {
      ctx.state.replaceMessages(repaired.messages);
    }

    const afterTokens = this.estimateMessages(ctx.messages);
    const afterFull = this.estimateFullRequest(ctx);
    return {
      before: beforeTokens,
      after: afterTokens,
      fullRequestTokensBefore: beforeFull,
      fullRequestTokensAfter: afterFull,
      reductions,
      collapsedDigest,
      repaired: repaired.report.changed
        ? {
            removedToolUses: repaired.report.removedToolUses,
            removedToolResults: repaired.report.removedToolResults,
            removedMessages: repaired.report.removedMessages,
          }
        : undefined,
    };
  }

  /**
   * Estimate the full API request token count: messages + systemPrompt + toolDefs.
   * This is the accurate figure for context-window pressure monitoring.
   */
  private estimateFullRequest(ctx: Context): number {
    const breakdown = estimateRequestTokens(ctx.messages, ctx.systemPrompt, ctx.tools ?? []);
    return breakdown.total;
  }

  private eliseOldToolResults(
    ctx: Context,
    preserveK = this.preserveK,
    eliseThreshold = this.eliseThreshold,
  ): number {
    const messages = ctx.messages;
    // Walk backwards counting (user + assistant) pairs to determine where
    // the preservation window really starts. This is more accurate than
    // the fixed multiplier which assumes every turn is 1 message pair.
    let pairCount = 0;
    let preserveStart = messages.length;
    for (let i = messages.length - 1; i >= 0 && pairCount < preserveK; i--) {
      const m = messages[i];
      if (!m) continue;
      if (m.role === 'user' || m.role === 'assistant') {
        pairCount++;
        preserveStart = i;
      }
    }

    // Ensure tool_use/tool_result protocol pairs are preserved together.
    // Walk forward through the preserved window: if an assistant message
    // at or after preserveStart contains a tool_use, also preserve the
    // immediately following message (the tool_result) so neither is elided.
    for (let i = preserveStart; i < messages.length; i++) {
      const m = messages[i];
      if (!m || typeof m.content === 'string' || !Array.isArray(m.content)) continue;
      const hasToolUse = m.content.some((b) => b.type === 'tool_use');
      if (hasToolUse && i + 1 < messages.length) {
        const next = messages[i + 1];
        if (
          next &&
          next.role === 'user' &&
          typeof next.content !== 'string' &&
          Array.isArray(next.content) &&
          next.content.some((b) => b.type === 'tool_result')
        ) {
          // Extend preserveStart to cover the tool_result as well so
          // the protocol pair stays complete and readable.
          preserveStart = i + 1;
        }
      }
    }

    let saved = 0;
    let changed = false;
    const nextMessages = new Array(messages.length);
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Only process messages before the preservation window
      if (i >= preserveStart) {
        nextMessages[i] = msg;
        continue;
      }
      if (!msg || !Array.isArray(msg.content)) {
        nextMessages[i] = msg;
        continue;
      }
      const newContent: ContentBlock[] = msg.content.map((b) => {
        if (b.type !== 'tool_result') return b;
        const tokens = estimateToolResultTokens(b.content);
        if (tokens < eliseThreshold) return b;
        saved += tokens;
        const elided: ToolResultBlock = {
          type: 'tool_result',
          tool_use_id: b.tool_use_id,
          content: `[elided: ~${tokens} tokens]`,
          is_error: b.is_error,
        };
        return elided;
      });
      // Check whether any block actually changed by reference equality
      if (
        newContent.length === msg.content.length &&
        newContent.every((b, idx) => b === msg.content[idx])
      ) {
        nextMessages[i] = msg;
      } else {
        nextMessages[i] = { ...msg, content: newContent };
        changed = true;
      }
    }
    if (changed) ctx.state.replaceMessages(nextMessages);
    return saved;
  }

  /**
   * Lossless rule-based collapse of ancient turns into a single digest message.
   *
   * Preserves ALL textual content of the collapsed range — user instructions,
   * assistant decisions/conclusions, and any prior digests (chained forward so
   * the digest stays lossless across repeated compactions). Only `tool_use` /
   * `tool_result` protocol blocks are dropped and replaced with a count marker;
   * their full payload already lives in the session log. No sub-LLM call.
   *
   * Returns the token savings and the digest text (for audit logging).
   */
  private collapseAncientTurns(
    ctx: Context,
    preserveK = this.preserveK,
  ): { saved: number; digest?: string | undefined } {
    const messages = ctx.messages;
    const cutTarget = Math.max(0, messages.length - preserveK * 2);
    if (cutTarget <= 0) return { saved: 0 };

    // Find a safe boundary: nearest user-message-with-text at or after cutTarget
    let boundary = -1;
    for (let i = cutTarget; i < messages.length; i++) {
      const m = messages[i];
      if (!m) continue;
      if (m.role === 'user' && hasTextContent(m)) {
        boundary = i;
        break;
      }
    }
    if (boundary <= 0) return { saved: 0 };

    const removed = messages.slice(0, boundary);
    const removedTokens = this.estimateMessages(removed);

    const digest =
      buildLosslessDigest(removed) ||
      `${removed.length} earlier turns (no textual content; tool I/O omitted — see session log)`;

    const summaryMsg: Message = {
      role: 'system',
      content: `[prior_turns_digest: ${digest}]`,
    };

    // L1-A: route through ConversationState so subscribers see the rewrite.
    const tail = ctx.messages.slice(boundary);
    ctx.state.replaceMessages([summaryMsg, ...tail]);
    return {
      saved: Math.max(0, removedTokens - this.estimateMessages([summaryMsg])),
      digest,
    };
  }

  private estimateMessages(messages: Message[]): number {
    let total = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') {
        total += this.estimator(m.content);
      } else {
        for (const b of m.content) {
          if (b.type === 'text') total += this.estimator(b.text);
          else if (b.type === 'tool_use') total += estimateToolInputTokens(b.input);
          else if (b.type === 'tool_result') total += estimateToolResultTokens(b.content);
        }
      }
    }
    return total;
  }
}

function readContextWindowPolicy(ctx: Context): ContextWindowPolicy | null {
  const policy = ctx.meta?.['contextWindowPolicy'];
  if (!policy || typeof policy !== 'object') return null;
  const candidate = policy as Partial<ContextWindowPolicy>;
  if (
    typeof candidate.preserveK !== 'number' ||
    typeof candidate.eliseThreshold !== 'number'
  ) {
    return null;
  }
  return candidate as ContextWindowPolicy;
}

function hasTextContent(m: Message): boolean {
  if (typeof m.content === 'string') return m.content.trim().length > 0;
  return m.content.some((b) => b.type === 'text' && b.text.trim().length > 0);
}

/**
 * Render a message range as a lossless textual digest. Every text block is
 * kept verbatim (across all roles, so prior `system` digests fold forward and
 * nothing accumulates as loss). `tool_use` / `tool_result` blocks are counted
 * and replaced with a marker rather than serialized — their payload is already
 * persisted in the session log. Empty/tool-only messages are skipped.
 */
function buildLosslessDigest(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    let text: string;
    let omitted = 0;
    if (typeof m.content === 'string') {
      text = m.content;
    } else {
      const parts: string[] = [];
      for (const b of m.content) {
        if (isTextBlock(b)) parts.push(b.text);
        else if (b.type === 'tool_use' || b.type === 'tool_result') omitted++;
      }
      text = parts.join(' ');
    }
    if (text.trim().length === 0 && omitted === 0) continue;
    const marker = omitted > 0 ? ` [${omitted} tool call(s) omitted — see session log]` : '';
    lines.push(`[${m.role}]: ${text}${marker}`);
  }
  return lines.join('\n');
}
