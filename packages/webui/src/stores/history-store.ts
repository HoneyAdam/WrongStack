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
  /** Optimistically patch an entry's name (cleared when `name` is empty). */
  updateEntryName: (id: string, name: string) => void;
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
  updateEntryName: (id, name) =>
    set((state) => ({
      entries: state.entries.map((e) => {
        if (e.id !== id) return e;
        const trimmed = name.trim();
        if (!trimmed) {
          const { name: _omit, ...rest } = e;
          return rest as SessionHistoryEntry;
        }
        return { ...e, name: trimmed };
      }),
    })),
  clearHistory: () => set({ entries: [] }),
}));
