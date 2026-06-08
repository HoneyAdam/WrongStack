import { create } from 'zustand';
import type { PhaseItem } from '@/components/PhasePanel';

// ── AutoPhase Store ────────────────────────────────────────────────────────

interface AutoPhaseState {
  phases: PhaseItem[];
  activePhaseId: string | null;
  overallPercent: number;
  autonomous: boolean;
  title: string | null;

  setState: (s: {
    phases?: PhaseItem[] | undefined;
    activePhaseId?: string | null | undefined;
    overallPercent?: number | undefined;
    autonomous?: boolean | undefined;
    title?: string | null | undefined;
  }) => void;
  clear: () => void;
}

export const useAutoPhaseStore = create<AutoPhaseState>()((set) => ({
  phases: [],
  activePhaseId: null,
  overallPercent: 0,
  autonomous: false,
  title: null,

  setState: (patch) =>
    set((prev) => ({
      phases: patch.phases ?? prev.phases,
      activePhaseId: patch.activePhaseId !== undefined ? patch.activePhaseId : prev.activePhaseId,
      overallPercent: patch.overallPercent ?? prev.overallPercent,
      autonomous: patch.autonomous ?? prev.autonomous,
      title: patch.title !== undefined ? patch.title : prev.title,
    })),
  clear: () =>
    set({
      phases: [],
      activePhaseId: null,
      overallPercent: 0,
      autonomous: false,
      title: null,
    }),
}));
