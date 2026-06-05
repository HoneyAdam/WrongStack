import { create } from 'zustand';
import type { SessionHistoryEntry } from './types.js';

// ============================================
// History Store
// ============================================

interface HistoryState {
  entries: SessionHistoryEntry[];
  loading: boolean;
  error: string | null;
  setEntries: (entries: SessionHistoryEntry[], error?: string | null) => void;
  setLoading: (loading: boolean) => void;
  removeEntry: (id: string) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()((set) => ({
  entries: [],
  loading: false,
  error: null,
  setEntries: (entries, error = null) => set({ entries, error, loading: false }),
  setLoading: (loading) => set({ loading }),
  removeEntry: (id) =>
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    })),
  clearHistory: () => set({ entries: [] }),
}));
