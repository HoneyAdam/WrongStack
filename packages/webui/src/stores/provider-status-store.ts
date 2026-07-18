import { create } from 'zustand';

export type ProviderHealthState = 'healthy' | 'degraded' | 'blocked';

export interface ProviderHealthEntry {
  providerId: string;
  model: string;
  state: ProviderHealthState;
  reason: string;
  updatedAt: number;
  stateExpiresAt?: number | undefined;
}

interface ProviderStatusState {
  entries: Record<string, ProviderHealthEntry>;
  update: (entry: ProviderHealthEntry) => void;
  hydrate: (entries: ProviderHealthEntry[]) => void;
  clear: () => void;
}

const keyOf = (entry: Pick<ProviderHealthEntry, 'providerId' | 'model'>) =>
  `${entry.providerId}\u0000${entry.model}`;

export const useProviderStatusStore = create<ProviderStatusState>()((set) => ({
  entries: {},
  update: (entry) =>
    set((state) => {
      const next = { ...state.entries };
      const key = keyOf(entry);
      if (entry.state === 'healthy') delete next[key];
      else next[key] = entry;
      return { entries: next };
    }),
  hydrate: (entries) =>
    set({
      entries: Object.fromEntries(
        entries.filter((entry) => entry.state !== 'healthy').map((entry) => [keyOf(entry), entry]),
      ),
    }),
  clear: () => set({ entries: {} }),
}));
