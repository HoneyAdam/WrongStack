import { create } from 'zustand';
import type { WorktreeDiffSummary, WorktreeHandleView, WorktreeOrphanView } from '../types.js';

// ── Worktree store (live backend state; not persisted) ──────────────────────

interface WorktreeActivity {
  handleId: string;
  kind: string;
  text: string;
  at: number;
}

interface WorktreeCleanResult {
  ok: boolean;
  removed: number;
  reason?: string;
  at: number;
}

interface WorktreeMergeResult {
  ok: boolean;
  branch: string;
  conflict?: boolean;
  conflictFiles?: string[];
  reason?: string;
  at: number;
}

interface WorktreeState {
  worktrees: WorktreeHandleView[];
  baseBranch: string;
  activity: WorktreeActivity[];
  /** Disk-scanned orphans left by previous/crashed runs. */
  orphans: WorktreeOrphanView[];
  /** Whether cleaning is currently allowed (no live run). */
  canClean: boolean;
  /** Why cleaning is blocked, when canClean is false. */
  cleanBlockedReason?: string;
  /** Outcome of the last cleanup. */
  cleanResult: WorktreeCleanResult | null;
  /** Outcome of the last per-worktree merge. */
  mergeResult: WorktreeMergeResult | null;
  /** Compact change summary per worktree dir (lazy, from "View changes"). */
  diffByDir: Record<string, WorktreeDiffSummary | null>;
  setSnapshot: (worktrees: WorktreeHandleView[], baseBranch: string) => void;
  pushEvent: (e: WorktreeActivity) => void;
  setOrphans: (orphans: WorktreeOrphanView[], canClean: boolean, reason?: string) => void;
  setCleanResult: (r: WorktreeCleanResult | null) => void;
  setMergeResult: (r: WorktreeMergeResult | null) => void;
  setDiff: (dir: string, summary: WorktreeDiffSummary | null) => void;
}

export const useWorktreeStore = create<WorktreeState>()((set) => ({
  worktrees: [],
  baseBranch: '',
  activity: [],
  orphans: [],
  canClean: false,
  cleanResult: null,
  mergeResult: null,
  diffByDir: {},
  setSnapshot: (worktrees, baseBranch) => set({ worktrees, baseBranch }),
  pushEvent: (e) => set((s) => ({ activity: [...s.activity, e].slice(-40) })),
  setOrphans: (orphans, canClean, cleanBlockedReason) =>
    set({ orphans, canClean, cleanBlockedReason }),
  setCleanResult: (cleanResult) => set({ cleanResult }),
  setMergeResult: (mergeResult) => set({ mergeResult }),
  setDiff: (dir, summary) => set((s) => ({ diffByDir: { ...s.diffByDir, [dir]: summary } })),
}));
