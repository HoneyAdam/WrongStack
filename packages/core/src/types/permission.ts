import type { Tool, Permission } from './tool.js';
import type { Context } from '../core/context.js';

export interface TrustPolicy {
  [toolNameOrPattern: string]: {
    allow?: string[];
    deny?: string[];
    auto?: boolean;
    trustWorkdir?: boolean;
    denyPrivate?: boolean;
  };
}

export interface PermissionDecision {
  permission: Permission;
  reason?: string;
  source: 'default' | 'trust' | 'yolo' | 'user' | 'deny';
}

export interface PermissionPolicy {
  evaluate(tool: Tool, input: unknown, ctx: Context): Promise<PermissionDecision>;
  trust(rule: { tool: string; pattern: string }): Promise<void>;
  reload(): Promise<void>;
}
