import { create } from 'zustand';
import type { GoalState } from '@/components/GoalPanel';
import { parseGoalState } from '@/components/GoalPanel';

// ── Goal Store ─────────────────────────────────────────────────────────────

interface GoalStoreState {
  goal: GoalState | null;
  setGoal: (raw: Record<string, unknown> | null) => void;
  clear: () => void;
}

export const useGoalStore = create<GoalStoreState>()((set) => ({
  goal: null,
  setGoal: (raw) => set({ goal: parseGoalState(raw) }),
  clear: () => set({ goal: null }),
}));
