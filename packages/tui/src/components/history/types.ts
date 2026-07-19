import type { TodoItem } from '@wrongstack/core';
import type { Lang } from '../../highlight.js';

// ============================================
// Shared types for history components
// ============================================

// ── Autonomy agent status — used by the banner ────────────────────────────

export interface AutonomyAgentStatus {
  /** Short display name (e.g. "Brain", "Shadow", "Kanban", "Mailbox", "Memory"). */
  name: string;
  /** Whether this agent is currently alive and reporting. */
  online: boolean;
  /** Optional detail line (risk level, interval, model, etc.). */
  detail?: string | undefined;
}

export interface MemoryActivationItem {
  id: string;
  kind: string;
  text: string;
  score: number;
  relationStrength: number;
  anchors: string[];
  tags: string[];
  activationReasons: string[];
  importance: number;
  confidence: number;
  freshness: number;
  persistence: string;
}

export type HistoryEntry =
  | { id: number; kind: 'user'; text: string; queued?: boolean | undefined; pasteContent?: string | undefined }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'thinking'; text: string }
  | {
      id: number;
      kind: 'tool';
      name: string;
      durationMs: number;
      ok: boolean;
      input?: unknown | undefined;
      output?: string | undefined;
      /** Full byte length of the result body the model actually received
       *  (post-cap, post-scrub). Carried separately because `output` is a
       *  ~400-char preview — `outputBytes` is what the model paid for. */
      outputBytes?: number | undefined;
      /** ~3.5 chars/token estimate over `outputBytes`. Cheap to render in
       *  the chip; the authoritative count lives in provider.response.usage. */
      outputTokens?: number | undefined;
      /** Real line count for tools that have a meaningful one — read counts
       *  numbered prefixes, shell/grep/logs count newlines. Undefined for
       *  tools without a line notion (json, fetch, …). */
      outputLines?: number | undefined;
      /**
       * Per-tool on-screen result render mode. `simple` hides the body
       * preview and shows only meta (line count, byte size); `extend`
       * shows the full preview. Mirrors the CLI's `setResultRenderMode`
       * state. The frontend TUI reads this off the same
       * `tools.resultRenderMode[name]` config the CLI uses.
       */
      resultRenderMode?: 'simple' | 'extend' | undefined;
    }
  | { id: number; kind: 'info'; text: string }
  | { id: number; kind: 'warn'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'turn-summary'; text: string }
  | {
      id: number;
      kind: 'memory-activation';
      trigger: string;
      outcome: 'injected' | 'empty' | 'error';
      candidates: number;
      contextPressure: number;
      injectedChars: number;
      activated: MemoryActivationItem[];
      injectedIds: string[];
      rejected: Record<'duplicate' | 'belowScore' | 'alreadyVisible' | 'cooldown' | 'budget', number>;
      error?: string | undefined;
    }
  | {
      id: number;
      kind: 'memory-lifecycle';
      action: 'entered' | 'updated' | 'merged' | 'recovered' | 'exited' | 'related' | 'superseded' | 'archived' | 'staled' | 'contradicted';
      label: string;
      detail?: string | undefined;
    }
  | {
      id: number;
      kind: 'brain';
      status: 'thinking' | 'answered' | 'ask_human' | 'denied' | 'intervention';
      source: string;
      risk: 'low' | 'medium' | 'high' | 'critical';
      question: string;
      decision?: string | undefined;
      rationale?: string | undefined;
    }
  | {
      id: number;
      kind: 'banner';
      version: string;
      provider: string;
      model: string;
      cwd: string;
      family?: string | undefined;
      keyTail?: string | undefined;
      /** Current session id (e.g. "sess_01KXV6…"). Static per session lifetime,
       *  used for /resume, bug reports, and mailbox coordination. */
      sessionId?: string | undefined;
      /** Active fallback profile name (e.g. "default"), shown in the banner
       *  to make the active profile visible at a glance. */
      profile?: string | undefined;
      /** Absolute path to the active profile's config.json
       *  (e.g. "~/.wrongstack/profiles/default/config.json"). When present,
       *  the banner renders this full path with the profile name segment
       *  (the directory between "profiles/" and "/config.json") highlighted
       *  in the accent color, instead of the bare {@link profile} string. */
      profileConfigPath?: string | undefined;
      /** Background autonomy agents currently online/active (Brain, Shadow,
       *  Kanban, Mailbox, Memory, etc.). Rendered below the footer links. */
      autonomyAgents?: ReadonlyArray<AutonomyAgentStatus> | undefined;
      /** Latest version published to the npm registry, when known. Drives
       *  the "update available" indicator next to the version chip when
       *  paired with {@link updateAvailable}. */
      latestVersion?: string | undefined;
      /** True when the CLI detected a newer published version than
       *  {@link version}. The banner renders `(update available)` next to
       *  the version chip when set, so users notice without having to read
       *  the stderr notice. Source: preflight update-check (cache-aware). */
      updateAvailable?: boolean | undefined;
    }
  | { id: number; kind: 'confirm'; toolName: string; input: unknown; suggestedPattern: string }
  | {
      id: number;
      kind: 'subagent';
      agentLabel: string;
      agentColor: string;
      icon: string;
      text: string;
      detail?: string | undefined;
    };

export interface HistoryProps {
  entries: HistoryEntry[];
  /**
   * Store parsed next steps in the shared suggestion store so /next 1 works.
   * Called by the Entry component after parsing each assistant message.
   */
  setSuggestions?: ((steps: string[]) => void) | undefined;
  /**
   * Current autonomy mode. When 'auto', a marker is shown next to the first
   * next-step suggestion indicating it will be auto-submitted.
   */
  autonomyMode?: string | undefined;
  /**
   * Generation counter for wholesale history replacements (session resume).
   * Keys the internal <Static> so a replacement remounts it — Ink's Static
   * tracks written items by index and would otherwise skip replayed entries
   * whenever the new array is shorter than what it already printed.
   */
  generation?: number | undefined;
  streamingText?: string | undefined;
  /**
   * Optional live tail of the currently streaming tool. Rendered below the
   * assistant tail so the user sees both at once: model thinking and tool
   * output. Cleared automatically when the tool's `tool.executed` event
   * fires and the final entry lands in `entries`.
   */
  toolStream?: { toolUseId: string; name: string; text: string; startedAt: number } | null;
  /**
   * Minimum number of files before the per-tool multi-file diff summary
   * footer is rendered. `0` suppresses the footer entirely; any positive
   * number sets the cutoff. When `undefined`, the code-block module's
   * default (`MULTI_DIFF_SUMMARY_THRESHOLD`) is used.
   */
  multiDiffSummaryThreshold?: number | undefined;
  /**
   * Live todo list. When it has any `pending`/`in_progress` items, the
   * `💡 NEXT STEPS` panel is hidden and the suggestion store is not
   * written from the render path — mirrors the host callback's
   * `hasOpenTodos` gate (b0970387) so the two paths can't disagree about
   * whether suggestions are available.
   */
  todos?: readonly TodoItem[] | undefined;
  /**
   * Show the "Model Reasoning" blocks in chat history. When false,
   * `kind: 'thinking'` entries are hidden. Default: true.
   */
  showModelReasoning?: boolean | undefined;
}

export interface BodySegment {
  type: 'prose' | 'code';
  text: string;
  lang?: Lang | undefined;
}
