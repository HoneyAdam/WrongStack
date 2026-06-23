import { create } from 'zustand';
import type { PhaseItem } from '@/components/PhasePanel';

// ── AutoPhase Store ────────────────────────────────────────────────────────

export type AutoPhaseStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

interface AutoPhaseState {
  phases: PhaseItem[];
  activePhaseId: string | null;
  overallPercent: number;
  autonomous: boolean;
  title: string | null;
  status: AutoPhaseStatus;
  lastEvent: string | null;
  lastError: string | null;
  progress: {
    totalPhases: number;
    completed: number;
    failed: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
  } | null;

  setState: (s: {
    phases?: PhaseItem[] | undefined;
    activePhaseId?: string | null | undefined;
    overallPercent?: number | undefined;
    autonomous?: boolean | undefined;
    title?: string | null | undefined;
    status?: AutoPhaseStatus | undefined;
    lastEvent?: string | null | undefined;
    lastError?: string | null | undefined;
    progress?: AutoPhaseState['progress'] | undefined;
  }) => void;
  clear: () => void;
}

export const useAutoPhaseStore = create<AutoPhaseState>()((set) => ({
  phases: [],
  activePhaseId: null,
  overallPercent: 0,
  autonomous: false,
  title: null,
  status: 'idle',
  lastEvent: null,
  lastError: null,
  progress: null,

  setState: (patch) =>
    set((prev) => ({
      phases: patch.phases ?? prev.phases,
      activePhaseId: patch.activePhaseId !== undefined ? patch.activePhaseId : prev.activePhaseId,
      overallPercent: patch.overallPercent ?? prev.overallPercent,
      autonomous: patch.autonomous ?? prev.autonomous,
      title: patch.title !== undefined ? patch.title : prev.title,
      status: patch.status ?? prev.status,
      lastEvent: patch.lastEvent !== undefined ? patch.lastEvent : prev.lastEvent,
      lastError: patch.lastError !== undefined ? patch.lastError : prev.lastError,
      progress: patch.progress !== undefined ? patch.progress : prev.progress,
    })),
  clear: () =>
    set({
      phases: [],
      activePhaseId: null,
      overallPercent: 0,
      autonomous: false,
      title: null,
      status: 'idle',
      lastEvent: null,
      lastError: null,
      progress: null,
    }),
}));
