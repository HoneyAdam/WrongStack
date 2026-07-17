import { create } from 'zustand';
import { getWSClient } from '@/lib/ws-client';
import { type GoalJournalEntry, type GoalState, parseGoalState } from '@/lib/goal';

// ── Goal State Store (goal.json tracking / eternal goal) ──────────────────

interface GoalStateStoreState {
  goal: GoalState | null;
  setGoal: (raw: Record<string, unknown> | null) => void;
  clear: () => void;
  appendJournalEntry: (entry: GoalJournalEntry) => void;
  /** Request the latest goal state from the server. Safe to call any time. */
  refresh: () => void;
}

export const useGoalStateStore = create<GoalStateStoreState>()((set) => ({
  goal: null,
  setGoal: (raw) => set({ goal: parseGoalState(raw) }),
  clear: () => set({ goal: null }),
  appendJournalEntry: (entry) =>
    set((state) => {
      if (!state.goal) return state;
      return {
        goal: {
          ...state.goal,
          iterations: Math.max(state.goal.iterations, entry.iteration),
          lastTask: entry.task ?? state.goal.lastTask,
          lastStatus: entry.status ?? state.goal.lastStatus,
          journal: [entry, ...(state.goal.journal ?? [])].slice(0, 200),
        },
      };
    }),
  refresh: () => {
    try {
      getWSClient()?.send?.({ type: 'goal-state.get' });
    } catch {
      // WS not connected — harmless
    }
  },
}));
