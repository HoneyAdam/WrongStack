import type { Context } from '../core/context.js';

export interface CompactRepairReport {
  removedToolUses: string[];
  removedToolResults: string[];
  removedMessages: number;
}

export interface CompactReport {
  before: number;
  after: number;
  reductions: { phase: 'elision' | 'summary' | 'selective'; saved: number }[];
  repaired?: CompactRepairReport;
}

export interface Compactor {
  compact(ctx: Context, opts?: { aggressive?: boolean }): Promise<CompactReport>;
}
