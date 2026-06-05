import { create } from 'zustand';
import type { WorktreeHandleView } from '../types.js';

// ── Worktree store (live backend state; not persisted) ──────────────────────

interface WorktreeActivity {
  handleId: string;
  kind: string;
  text: string;
  at: number;
}

interface WorktreeState {
  worktrees: WorktreeHandleView[];
  baseBranch: string;
  activity: WorktreeActivity[];
  setSnapshot: (worktrees: WorktreeHandleView[], baseBranch: string) => void;
  pushEvent: (e: WorktreeActivity) => void;
}

export const useWorktreeStore = create<WorktreeState>()((set) => ({
  worktrees: [],
  baseBranch: '',
  activity: [],
  setSnapshot: (worktrees, baseBranch) => set({ worktrees, baseBranch }),
  pushEvent: (e) => set((s) => ({ activity: [...s.activity, e].slice(-40) })),
}));
