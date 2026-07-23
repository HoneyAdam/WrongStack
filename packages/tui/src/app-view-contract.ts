import type { AgentTimelineEntry, Director } from '@wrongstack/core/coordination';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AppProps } from './app-props.js';
import type { Action, State } from './app-state.js';
import type { deriveAppViewState } from './app-view-state.js';
import type { KeyEvent } from './components/input.js';
import type { CronListResult } from './cron-slash.js';
import type { useGitSessionStatus } from './hooks/use-git-session-status.js';
import type { useLiveTodos } from './hooks/use-live-todos.js';
import type { useMailboxViewModel } from './hooks/use-mailbox-view-model.js';
import type { useStatusbarViewModel } from './hooks/use-statusbar-view-model.js';
import type { useTuiActivity } from './hooks/use-tui-activity.js';
import type { useTuiEnvironmentState } from './hooks/use-tui-environment-state.js';
import type { DOMElement } from './ink.js';
import type { StatuslineMode } from './settings-contracts.js';

export interface AppViewRuntime {
  state: State;
  dispatch: Dispatch<Action>;
  activity: ReturnType<typeof useTuiActivity>;
  environment: ReturnType<typeof useTuiEnvironmentState>;
  statusbar: ReturnType<typeof useStatusbarViewModel>;
  mailbox: ReturnType<typeof useMailboxViewModel>;
  gitInfo: ReturnType<typeof useGitSessionStatus>;
  viewState: ReturnType<typeof deriveAppViewState>;
  mouseMode: boolean;
  /**
   * Reports the measured history content height (rows) after every layout so
   * the host can clamp the scroll offset and drive the "N new lines"
   * affordance. Optional: when omitted, the ScrollableHistory's measurement
   * is a no-op and `state.totalLines` stays at its default. The callback is
   * passed through to ScrollableHistory and invoked after each layout pass
   * with the freshly measured row count.
   */
  onMeasure?: ((totalLines: number) => void) | undefined;
  bottomRegionRef: MutableRefObject<DOMElement | null>;
  statusBarWrapRef: MutableRefObject<DOMElement | null>;
  belowStatusBarRef: MutableRefObject<DOMElement | null>;
  stableOnKey: (input: string, key: KeyEvent) => void;
  liveTodos: ReturnType<typeof useLiveTodos>;
  liveSettings: ReturnType<NonNullable<AppProps['getSettings']>> | undefined;
  liveAnimationStyle: State['settingsPicker']['animationStyle'];
  liveStatuslineMode: StatuslineMode;
  projectName: string | undefined;
  workingDirChip: string | undefined;
  handleRewindTo: (checkpointIndex: number) => Promise<void>;
  activeCtrlRef: MutableRefObject<AbortController | null>;
  clearPendingConfirms: () => void;
  liveDirector: () => Director | null;
  dismissedEscAtRef: MutableRefObject<number>;
  enhanceOriginalRef: MutableRefObject<string>;
  enhanceStartedAt: number | null;
  enhanceDurationMs: number | null;
  refineProviderId: string | null;
  refineModel: string | null;
  setEnhanceCountdown: Dispatch<SetStateAction<number | null>>;
  enhanceCountdown: number | null;
  nextStepsAutoSubmitCountdown: number | null;
  nextStepsAutoSubmitLabel: string | null;
  setDraft: (buffer: string, cursor: number) => void;
  focusedBoardId: string | null;
  getCronJobs: () => Promise<CronListResult>;
  getLeaderTranscript: () => AgentTimelineEntry[];
  coordinatorRunning: boolean;
  enhanceDelayMs: number;
}

export interface AppViewProps {
  host: AppProps;
  runtime: AppViewRuntime;
}
