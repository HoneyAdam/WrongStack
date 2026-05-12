import type { Context } from '../core/context.js';

export type Permission = 'auto' | 'confirm' | 'deny';

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  [k: string]: unknown;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  usageHint?: string;
  inputSchema: JSONSchema;
  permission: Permission;
  mutating: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
  execute(input: I, ctx: Context, opts: { signal: AbortSignal }): Promise<O>;
}

export interface ToolCallContext {
  tool: Tool;
  input: unknown;
  callId: string;
  ctx: Context;
  signal: AbortSignal;
}
