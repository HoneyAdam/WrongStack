/**
 * Project-scoped multi-kanban data model.
 *
 * Boards are stored as JSON files under `<project>/.wrongstack/kanbans/`.
 * The model is intentionally provider-free: LLMs can manipulate kanban data
 * through tools, but core CRUD stays deterministic and file-based.
 */

export type KanbanTaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type KanbanTaskStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'completed'
  | 'failed'
  | 'archived';

export type KanbanCheckType = 'manual' | 'auto' | 'agent' | 'test' | 'review';

export type KanbanCheckStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export type KanbanLinkType =
  | 'issue'
  | 'pr'
  | 'doc'
  | 'commit'
  | 'design'
  | 'file'
  | 'url'
  | 'other';

export type KanbanAgentRunStatus =
  | 'assigned'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type KanbanGoalMetricStatus = 'pending' | 'met' | 'missed' | 'waived';

export interface KanbanAgentAssignment {
  agentId?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  fallbackProfile?: string | undefined;
  fallbackModels?: string[] | undefined;
  tools?: string[] | undefined;
  allowedCapabilities?: string[] | undefined;
  status: KanbanAgentRunStatus;
  dispatchedAt?: string | undefined;
  completedAt?: string | undefined;
  subagentId?: string | undefined;
  runTaskId?: string | undefined;
  lastResult?: string | undefined;
  error?: string | undefined;
}

export interface KanbanCheck {
  id: string;
  description: string;
  type: KanbanCheckType;
  status: KanbanCheckStatus;
  checkedBy?: string | undefined;
  checkedAt?: string | undefined;
  notes?: string | undefined;
}

export interface KanbanLink {
  url: string;
  title?: string | undefined;
  type: KanbanLinkType;
}

export interface KanbanNote {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface KanbanGoalMetric {
  id: string;
  name: string;
  status: KanbanGoalMetricStatus;
  target?: string | number | undefined;
  current?: string | number | undefined;
  unit?: string | undefined;
  notes?: string | undefined;
  updatedAt?: string | undefined;
}

export interface KanbanTaskChainRef {
  chainId: string;
  order: number;
  previousTaskId?: string | undefined;
  nextTaskId?: string | undefined;
}

export interface KanbanTaskOrigin {
  system: string;
  graphId?: string | undefined;
  phaseId?: string | undefined;
  taskId?: string | undefined;
  specId?: string | undefined;
}

export interface KanbanTask {
  id: string;
  title: string;
  description?: string | undefined;
  columnId: string;
  order: number;
  priority: KanbanTaskPriority;
  status: KanbanTaskStatus;
  assignedAgent?: string | undefined;
  assignee?: string | undefined;
  assignment?: KanbanAgentAssignment | undefined;
  dependsOn?: string[] | undefined;
  chain?: KanbanTaskChainRef | undefined;
  parentTaskId?: string | undefined;
  childTaskIds?: string[] | undefined;
  mergedIntoTaskId?: string | undefined;
  mergedFromTaskIds?: string[] | undefined;
  origin?: KanbanTaskOrigin | undefined;
  successCriteria?: KanbanCheck[] | undefined;
  goalMetrics?: KanbanGoalMetric[] | undefined;
  labels?: string[] | undefined;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
  estimatedHours?: number | undefined;
  actualHours?: number | undefined;
  links?: KanbanLink[] | undefined;
  notes?: KanbanNote[] | undefined;
}

export interface KanbanColumn {
  id: string;
  title: string;
  description?: string | undefined;
  color?: string | undefined;
  order: number;
  wipLimit?: number | undefined;
}

export interface KanbanBoard {
  id: string;
  title: string;
  description?: string | undefined;
  tags?: string[] | undefined;
  columns: KanbanColumn[];
  tasks: KanbanTask[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
  generatedBy?: string | undefined;
  version: number;
}

export interface KanbanBoardMeta {
  id: string;
  title: string;
  description?: string | undefined;
  columnCount: number;
  taskCount: number;
  completedTaskCount: number;
  tags?: string[] | undefined;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string | undefined;
}

export type KanbanBoardSummary = Pick<
  KanbanBoard,
  'id' | 'title' | 'description' | 'tags' | 'createdAt' | 'updatedAt'
> & {
  columnCount: number;
  taskCount: number;
  completedTaskCount: number;
  lastActivity?: string | undefined;
};

export interface CreateKanbanBoardInput {
  title: string;
  description?: string | undefined;
  tags?: string[] | undefined;
  columns?: KanbanColumn[] | undefined;
  tasks?: Array<Partial<KanbanTask> & Pick<KanbanTask, 'title'>> | undefined;
  generatedBy?: string | undefined;
}

export interface UpdateKanbanBoardInput {
  title?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  columns?: KanbanColumn[] | undefined;
  completedAt?: string | null | undefined;
}

export interface DuplicateKanbanBoardInput {
  title?: string | undefined;
  includeTasks?: boolean | undefined;
  includeCompletedTasks?: boolean | undefined;
  preserveAssignment?: boolean | undefined;
  generatedBy?: string | undefined;
}

export interface CreateKanbanColumnInput {
  id?: string | undefined;
  title: string;
  description?: string | undefined;
  color?: string | undefined;
  order?: number | undefined;
  wipLimit?: number | undefined;
}

export interface UpdateKanbanColumnInput {
  title?: string | undefined;
  description?: string | undefined;
  color?: string | undefined;
  order?: number | undefined;
  wipLimit?: number | undefined;
}

export interface RemoveKanbanColumnOptions {
  moveTasksToColumnId?: string | undefined;
}

export interface CreateKanbanTaskInput {
  title: string;
  description?: string | undefined;
  columnId?: string | undefined;
  order?: number | undefined;
  priority?: KanbanTaskPriority | undefined;
  status?: KanbanTaskStatus | undefined;
  assignedAgent?: string | undefined;
  assignee?: string | undefined;
  assignment?: KanbanAgentAssignment | undefined;
  dependsOn?: string[] | undefined;
  chain?: KanbanTaskChainRef | undefined;
  parentTaskId?: string | undefined;
  childTaskIds?: string[] | undefined;
  mergedIntoTaskId?: string | undefined;
  mergedFromTaskIds?: string[] | undefined;
  origin?: KanbanTaskOrigin | undefined;
  labels?: string[] | undefined;
  estimatedHours?: number | undefined;
  actualHours?: number | undefined;
  successCriteria?: KanbanCheck[] | undefined;
  goalMetrics?: KanbanGoalMetric[] | undefined;
  links?: KanbanLink[] | undefined;
  notes?: KanbanNote[] | undefined;
}

export interface UpdateKanbanTaskInput {
  title?: string | undefined;
  description?: string | undefined;
  columnId?: string | undefined;
  order?: number | undefined;
  priority?: KanbanTaskPriority | undefined;
  status?: KanbanTaskStatus | undefined;
  assignedAgent?: string | null | undefined;
  assignee?: string | null | undefined;
  assignment?: KanbanAgentAssignment | null | undefined;
  dependsOn?: string[] | undefined;
  chain?: KanbanTaskChainRef | null | undefined;
  parentTaskId?: string | null | undefined;
  childTaskIds?: string[] | undefined;
  mergedIntoTaskId?: string | null | undefined;
  mergedFromTaskIds?: string[] | undefined;
  origin?: KanbanTaskOrigin | null | undefined;
  labels?: string[] | undefined;
  estimatedHours?: number | undefined;
  actualHours?: number | undefined;
  successCriteria?: KanbanCheck[] | undefined;
  goalMetrics?: KanbanGoalMetric[] | undefined;
  links?: KanbanLink[] | undefined;
}

export interface CopyKanbanTaskOptions {
  targetColumnId?: string | undefined;
  targetOrder?: number | undefined;
  preserveAssignment?: boolean | undefined;
  preserveDependencies?: boolean | undefined;
}

export interface AssignKanbanTaskInput {
  agentId?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  fallbackProfile?: string | undefined;
  fallbackModels?: string[] | undefined;
  tools?: string[] | undefined;
  allowedCapabilities?: string[] | undefined;
  assignee?: string | undefined;
  status?: KanbanAgentRunStatus | undefined;
}

export interface SplitKanbanTaskInput {
  titles: string[];
  columnId?: string | undefined;
  inheritAssignment?: boolean | undefined;
  inheritLabels?: boolean | undefined;
  inheritSuccessCriteria?: boolean | undefined;
  inheritGoalMetrics?: boolean | undefined;
  inheritDependencies?: boolean | undefined;
  chainChildren?: boolean | undefined;
  rewireDependents?: boolean | undefined;
}

export interface MergeKanbanTasksInput {
  taskIds: string[];
  title: string;
  description?: string | undefined;
  targetColumnId?: string | undefined;
  preserveAssignment?: boolean | undefined;
  closeSourceTasks?: boolean | undefined;
}

export interface SetKanbanTaskChainInput {
  taskIds: string[];
  chainId?: string | undefined;
  enforceDependencies?: boolean | undefined;
}

export interface AddKanbanGoalMetricInput {
  name: string;
  status?: KanbanGoalMetricStatus | undefined;
  target?: string | number | undefined;
  current?: string | number | undefined;
  unit?: string | undefined;
  notes?: string | undefined;
}

export type UpdateKanbanGoalMetricInput = Partial<Omit<KanbanGoalMetric, 'id'>>;

export interface ClaimKanbanTaskInput extends AssignKanbanTaskInput {
  boardId?: string | undefined;
  taskId?: string | undefined;
}

export interface ReleaseKanbanTaskClaimInput {
  status?: 'pending' | 'ready' | 'blocked' | undefined;
  reason?: string | undefined;
  clearAssignee?: boolean | undefined;
}

export interface KanbanOrchestrationSnapshot {
  generatedAt: string;
  boards: KanbanBoardSummary[];
  ready: KanbanSearchResult[];
  queued: KanbanSearchResult[];
  running: KanbanSearchResult[];
  blocked: KanbanSearchResult[];
  review: KanbanSearchResult[];
  failed: KanbanSearchResult[];
  completed: KanbanSearchResult[];
}

export interface KanbanGenerationInput {
  description: string;
  context?: string | undefined;
  columnCount?: number | undefined;
  columns?: string[] | undefined;
  title?: string | undefined;
}

export interface KanbanSearchInput {
  query?: string | undefined;
  boardId?: string | undefined;
  assignedAgent?: string | undefined;
  status?: KanbanTaskStatus | undefined;
  priority?: KanbanTaskPriority | undefined;
  label?: string | undefined;
  readyOnly?: boolean | undefined;
  chainId?: string | undefined;
}

export interface KanbanSearchResult {
  board: KanbanBoardSummary;
  task: KanbanTask;
}

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', title: 'Backlog', order: 0, wipLimit: 0, color: '#64748b' },
  { id: 'todo', title: 'To Do', order: 1, wipLimit: 0, color: '#2563eb' },
  { id: 'in-progress', title: 'In Progress', order: 2, wipLimit: 5, color: '#d97706' },
  { id: 'review', title: 'Review', order: 3, wipLimit: 0, color: '#7c3aed' },
  { id: 'done', title: 'Done', order: 4, wipLimit: 0, color: '#16a34a' },
];

export const CURRENT_KANBAN_VERSION = 1;
