import { create } from 'zustand';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CronJobView {
  name: string;
  intervalMs: number;
  action: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
  runCount: number;
  overdue: boolean;
}

export interface CronSnapshot {
  count: number;
  maxConcurrent: number;
  jobs: CronJobView[];
}

// ── Store ───────────────────────────────────────────────────────────────────

interface CronState {
  /** The latest cron job snapshot, or null before the first event arrives. */
  snapshot: CronSnapshot | null;
  /** Per-job last-fired timestamps, keyed by job name. Updated by cron.job_fired. */
  lastFiredAt: Record<string, string>;
  /** Monotonic update counter — React components can use this as a dep for re-render. */
  revision: number;

  setSnapshot: (snapshot: CronSnapshot) => void;
  recordFired: (name: string, ts: string) => void;
  clear: () => void;
}

export const useCronStore = create<CronState>()((set) => ({
  snapshot: null,
  lastFiredAt: {},
  revision: 0,

  setSnapshot: (snapshot) =>
    set((state) => ({
      snapshot,
      revision: state.revision + 1,
    })),

  recordFired: (name, ts) =>
    set((state) => ({
      lastFiredAt: { ...state.lastFiredAt, [name]: ts },
      revision: state.revision + 1,
    })),

  clear: () =>
    set({
      snapshot: null,
      lastFiredAt: {},
      revision: 0,
    }),
}));
