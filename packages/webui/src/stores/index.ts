// ── Barrel re-exports — all stores and types ──

export { useAutoPhaseStore } from './autophase-store.js';

export { useChatStore } from './chat-store.js';
export type { ConfigState } from './config-store.js';
export { useConfigStore } from './config-store.js';
export type {
  BudgetAlert,
  BudgetKind,
  ConsensusResult,
  ConsensusVote,
  CoordinatorStatus,
  FleetEvent,
  SubagentEntry,
  TaskEntry,
  VoteValue,
} from './coordinator-monitor-store.js';
export { useCoordinatorMonitorStore } from './coordinator-monitor-store.js';
export type { FileReference, FileReferenceInput } from './file-reference-store.js';
export {
  refLabel,
  refsToMarkdown,
  useFileReferenceStore,
} from './file-reference-store.js';
export type { OpenFile, TreeNode } from './file-store.js';
export { useFileStore } from './file-store.js';
export { EMPTY_AGENT_TRANSCRIPT, useFleetStore } from './fleet-store.js';
export type { GitChangedFile, GitDiffContent } from './git-changes-store.js';
export { useGitChangesStore } from './git-changes-store.js';
export type { GitInfo } from './git-info-store.js';
export { useGitInfoStore } from './git-info-store.js';
export type { CronJobView, CronSnapshot } from './cron-store.js';
export { useCronStore } from './cron-store.js';
export { useGoalStore } from './goal-store.js';
export { useHistoryStore } from './history-store.js';
export { type KanbanResultPayload, useKanbanStore } from './kanban-store.js';
export { useLocalPrefs } from './local-prefs.js';
export type { MailboxAgent, MailboxMessage } from './mailbox-store.js';
export { selectUnreadCount, useMailboxStore } from './mailbox-store.js';
export type { ClientCounts, CurrentSessionStats, MailActivity } from './monitor-store.js';
export { useMonitorStore } from './monitor-store.js';
export { type BackgroundStyle, useOfficeMapStore } from './office-map-store.js';
export {
  type SddBoardFeedEntry,
  type SddBoardSnapshotUI,
  type SddBoardStatus,
  type SddBoardSummary,
  type SddLifecycleResultUI,
  useSddBoardStore,
} from './sdd-board-store.js';
export {
  type SddWizardPhase,
  type SddWizardSnapshot,
  useSddWizardStore,
} from './sdd-wizard-store.js';
export { useSessionStore } from './session-store.js';
export { type SideEffectEntry, useSideEffectStore } from './side-effect-store.js';
export {
  type BoardTaskItem,
  type BoardTaskStatus,
  type SpecColumn,
  type SpecDetail,
  type SpecListItem,
  useSpecsStore,
} from './specs-store.js';
export type {
  AgentTranscriptEntry,
  AgentTranscriptKind,
  ChatMessage,
  FleetTimelineEvent,
  MessageContent,
  SessionHistoryEntry,
  SessionInfo,
  SubagentEvent,
  SubagentView,
  ToolExecution,
} from './types.js';
export type { Activity, DockSection, WorkDashboardTab } from './ui-store.js';
export {
  coerceActivity,
  resetUiNavigationToHome,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useUIStore,
} from './ui-store.js';
export type { VizEdge, VizEvent, VizNode } from './viz-store.js';
export { useVizStore } from './viz-store.js';
export { useWorktreeStore } from './worktree-store.js';
