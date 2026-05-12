export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'failed' | 'review' | 'completed';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskType = 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore';

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  assignee?: string;
  estimateHours?: number;
  actualHours?: number;
  tags?: string[];
  specRequirementId?: string;
  parentId?: string;
  children?: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskEdge {
  id: string;
  from: string;
  to: string;
  type: 'blocks' | 'depends_on' | 'relates_to' | 'implements';
  weight?: number;
}

export interface TaskGraph {
  id: string;
  specId: string;
  title: string;
  nodes: Map<string, TaskNode>;
  edges: TaskEdge[];
  rootNodes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskDependency {
  taskId: string;
  blockedBy: string[];
  blocking: string[];
}

export interface TaskAssignment {
  taskId: string;
  assignee: string;
  assignedAt: number;
}

export interface TaskProgress {
  total: number;
  pending: number;
  inProgress: number;
  blocked: number;
  failed: number;
  review: number;
  completed: number;
  percentComplete: number;
  estimatedHours: number;
  actualHours: number;
}

export interface TaskFilter {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  type?: TaskType[];
  assignee?: string[];
  tags?: string[];
  specRequirementId?: string;
}

export interface TaskSort {
  field: 'priority' | 'createdAt' | 'updatedAt' | 'status';
  direction: 'asc' | 'desc';
}

export interface CriticalPathResult {
  taskIds: string[];
  totalEstimateHours: number;
  bottleneckTasks: string[];
}

export function computeTaskProgress(graph: TaskGraph): TaskProgress {
  const nodes = Array.from(graph.nodes.values());
  const total = nodes.length;
  const completed = nodes.filter((n) => n.status === 'completed').length;
  const pending = nodes.filter((n) => n.status === 'pending').length;
  const inProgress = nodes.filter((n) => n.status === 'in_progress').length;
  const blocked = nodes.filter((n) => n.status === 'blocked').length;
  const failed = nodes.filter((n) => n.status === 'failed').length;
  const review = nodes.filter((n) => n.status === 'review').length;

  const estimatedHours = nodes.reduce((sum, n) => sum + (n.estimateHours ?? 0), 0);
  const actualHours = nodes.reduce((sum, n) => sum + (n.actualHours ?? 0), 0);

  return {
    total,
    pending,
    inProgress,
    blocked,
    failed,
    review,
    completed,
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
    estimatedHours,
    actualHours,
  };
}

export function findCriticalPath(graph: TaskGraph): CriticalPathResult {
  const nodes = Array.from(graph.nodes.values());
  const criticalNodes = nodes.filter((n) => n.priority === 'critical');
  const bottleneckTasks = criticalNodes
    .filter((n) => graph.edges.some((e) => e.to === n.id && e.type === 'depends_on'))
    .map((n) => n.id);

  const totalEstimateHours = criticalNodes.reduce((sum, n) => sum + (n.estimateHours ?? 0), 0);

  return {
    taskIds: criticalNodes.map((n) => n.id),
    totalEstimateHours,
    bottleneckTasks,
  };
}

export function topologicalSort(graph: TaskGraph): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const node = graph.nodes.get(id);
    if (!node) return;

    const outgoing = graph.edges.filter((e) => e.from === id);
    for (const edge of outgoing) {
      visit(edge.to);
    }

    result.push(id);
  }

  for (const rootId of graph.rootNodes) {
    visit(rootId);
  }

  return result;
}