import type { Context } from '../core/context.js';
import type { Tool } from '../types/tool.js';
import type { ToolResultBlock, ToolUseBlock } from '../types/blocks.js';

/**
 * Input for a single tool execution, scoped to a single iteration's budget.
 */
export interface ToolExecution {
  toolUse: ToolUseBlock;
  result: ToolResultBlock;
  /** True if the tool was not found in the registry. */
  unknownTool?: boolean;
  /** True if the tool execution threw an exception. */
  threw?: boolean;
}

/**
 * Output from a single tool execution.
 */
export interface ToolExecutionOutput {
  result: ToolResultBlock;
  tool?: Tool;
  durationMs: number;
}

/**
 * Result of running a batch of tools for a single agent iteration.
 */
export interface ToolBatchResult {
  outputs: ToolExecutionOutput[];
  remainingBudget: number;
}

export interface ToolExecutorOptions {
  permissionPolicy: import('../types/permission.js').PermissionPolicy;
  secretScrubber: import('../types/secret-scrubber.js').SecretScrubber;
  renderer?: import('../types/renderer.js').Renderer | undefined;
  /**
   * Optional event bus. When provided, the executor emits `tool.started`
   * before invoking each tool's `execute()`. Closes the observability gap
   * between "model decided to call tool" and "tool finished".
   */
  events?: import('../kernel/events.js').EventBus | undefined;
  iterationTimeoutMs?: number;
  perIterationOutputCapBytes?: number;
}

export interface ToolExecutorInit {
  registry: import('../registry/tool-registry.js').ToolRegistry;
  options: ToolExecutorOptions;
}

export type ToolExecutorStrategy = 'parallel' | 'sequential' | 'smart';