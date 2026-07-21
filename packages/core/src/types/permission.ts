import type { Context } from '../core/context.js';
import type { Permission, Tool } from './tool.js';

export interface TrustPolicy {
  [toolNameOrPattern: string]: {
    allow?: string[] | undefined;
    deny?: string[] | undefined;
    auto?: boolean | undefined;
    trustWorkdir?: boolean | undefined;
    denyPrivate?: boolean | undefined;
  };
}

export interface PermissionDecision {
  permission: Permission;
  reason?: string | undefined;
  source: 'default' | 'trust' | 'yolo' | 'yolo_destructive' | 'user' | 'deny' | 'context' | 'subagent_guard' | 'readonly_mode';
  /** Risk tier of the tool, if classified. */
  riskTier?: 'safe' | 'standard' | 'destructive' | undefined;
}

/**
 * A single evaluation step in the permission explainer trace.
 * Each step records a rule that was checked, whether it matched,
 * and what the effective decision would be if that rule wins.
 */
export interface PermissionTraceStep {
  /** Label identifying the rule, e.g. "session soft deny", "trust deny", "yolo". */
  rule: string;
  /** Whether this rule's condition matched the tool+input pair. */
  matched: boolean;
  /** The permission decision if this rule were the winner. */
  decision: 'auto' | 'deny' | 'confirm';
  /** The source label associated with this step. */
  source: string;
  /** Human-readable explanation of the outcome. */
  detail: string;
}

/**
 * Structured trace of a permission evaluation for debugging and CLI
 * explainer output. Contains every step that was checked and the
 * winning decision.
 */
export interface PermissionTrace {
  toolName: string;
  subject: string | null | undefined;
  /** The ordered list of rules checked, in evaluation priority order. */
  steps: PermissionTraceStep[];
  /** Index into `steps` of the winning rule. */
  winnerIndex: number;
  /** The final effective permission decision. */
  decision: PermissionDecision;
}

export interface PermissionPolicy {
  evaluate(tool: Tool, input: unknown, ctx: Context): Promise<PermissionDecision>;
  /**
   * Side-effect-free permission evaluation trace. Returns the same
   * logical result as `evaluate()` without prompting the user,
   * writing to trust files, or mutating session state.
   */
  explain?(tool: Tool, input: unknown, ctx: Context): Promise<PermissionTrace>;
  trust(rule: { tool: string; pattern: string }): Promise<void>;
  /**
   * Persist a permanent deny rule (mirrors trust). Written to trust.json.
   */
  deny(rule: { tool: string; pattern: string }): Promise<void>;
  /**
   * Block this tool+pattern for the remainder of the session (no persistence).
   * Used when user presses 'n' — prevents LLM retry from re-triggering confirm.
   */
  denyOnce(rule: { tool: string; pattern: string }): void;
  /**
   * Auto-approve this tool+pattern once (no persistence). Used when user
   * presses 'y' so the immediate confirmed re-run can proceed without making
   * future destructive calls silent.
   */
  allowOnce(rule: { tool: string; pattern: string }): void;
  reload(): Promise<void>;
  /** Optional runtime query for policies that support leader YOLO toggling. */
  getYolo?(): boolean;
  /** Optional runtime setter for policies that support leader YOLO toggling. */
  setYolo?(enabled: boolean): void;
  /** Optional runtime query for the deprecated destructive YOLO override. */
  getYoloDestructive?(): boolean;
  /** Optional runtime setter for the deprecated destructive YOLO override. */
  setYoloDestructive?(enabled: boolean): void;
  /** Query the deprecated destructive-confirm compatibility flag. */
  getConfirmDestructive?(): boolean;
  /** Compatibility setter; current default policy no longer confirms in YOLO mode. */
  setConfirmDestructive?(enabled: boolean): void;
  /** Set the prompt delegate (optional). */
  setPromptDelegate?(delegate: ((tool: Tool, input: unknown, suggestedPattern: string) => Promise<'yes' | 'no' | 'always' | 'deny'>) | undefined): void;
}
