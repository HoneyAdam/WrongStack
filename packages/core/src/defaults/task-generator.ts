import type { Specification, SpecRequirement } from '../types/spec.js';
import type { TaskNode, TaskGraph, TaskType, TaskPriority } from '../types/task-graph.js';
import { TaskTracker } from './task-tracker.js';
import type { TaskStore } from './task-tracker.js';

export interface TaskGeneratorOptions {
  taskTracker: TaskTracker;
}

export interface GeneratedTask {
  specRequirementId?: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  estimateHours?: number;
  tags?: string[];
}

export class TaskGenerator {
  constructor(private readonly opts: TaskGeneratorOptions) {}

  async generateFromSpec(spec: Specification): Promise<TaskGraph> {
    const graph = await this.opts.taskTracker.createGraph(spec.id, spec.title);

    const overview = spec.sections.find((s) => s.type === 'overview');
    if (overview) {
      this.opts.taskTracker.addNode({
        title: `Implement ${spec.title}`,
        description: overview.content,
        type: 'feature',
        priority: 'high',
        status: 'pending',
      });
    }

    // Group requirements by priority
    const criticalReqs = spec.requirements.filter((r) => r.priority === 'critical');
    const highReqs = spec.requirements.filter((r) => r.priority === 'high');
    const mediumReqs = spec.requirements.filter((r) => r.priority === 'medium');
    const lowReqs = spec.requirements.filter((r) => r.priority === 'low');

    for (const req of criticalReqs) {
      const task = this.createTaskFromRequirement(req, spec.title);
      this.opts.taskTracker.addNode(task);
    }

    for (const req of highReqs) {
      const task = this.createTaskFromRequirement(req, spec.title);
      this.opts.taskTracker.addNode(task);
    }

    for (const req of mediumReqs) {
      const task = this.createTaskFromRequirement(req, spec.title);
      this.opts.taskTracker.addNode(task);
    }

    for (const req of lowReqs) {
      const task = this.createTaskFromRequirement(req, spec.title);
      this.opts.taskTracker.addNode(task);
    }

    // API tasks
    if (spec.apiEndpoints && spec.apiEndpoints.length > 0) {
      const apiParent = this.opts.taskTracker.addNode({
        title: 'API Implementation',
        description: `Implement ${spec.apiEndpoints.length} API endpoints`,
        type: 'feature',
        priority: 'high',
        status: 'pending',
      });

      for (const endpoint of spec.apiEndpoints) {
        const task = this.createTaskFromEndpoint(endpoint);
        this.opts.taskTracker.addNode({
          ...task,
          parentId: apiParent.id,
        });
      }
    }

    // Test tasks
    const testTask = this.opts.taskTracker.addNode({
      title: 'Write Tests',
      description: 'Comprehensive test coverage for all features',
      type: 'test',
      priority: 'high',
      status: 'pending',
    });

    // Documentation tasks
    const docsTask = this.opts.taskTracker.addNode({
      title: 'Update Documentation',
      description: 'Update docs for new features',
      type: 'docs',
      priority: 'medium',
      status: 'pending',
    });

    return graph;
  }

  private createTaskFromRequirement(req: SpecRequirement, specTitle: string): Omit<TaskNode, 'id' | 'createdAt' | 'updatedAt'> {
    const type = this.mapRequirementType(req.type);
    const tags = [req.type, req.priority];

    return {
      title: req.description,
      description: this.buildDescription(req, specTitle),
      type,
      priority: this.mapPriority(req.priority),
      status: 'pending',
      specRequirementId: req.id,
      tags,
      estimateHours: this.estimateHours(req),
    };
  }

  private createTaskFromEndpoint(endpoint: NonNullable<Specification['apiEndpoints']>[number]): Omit<TaskNode, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      title: `${endpoint.method} ${endpoint.path}`,
      description: endpoint.description,
      type: 'feature',
      priority: 'high',
      status: 'pending',
      tags: [endpoint.method],
      estimateHours: this.estimateForEndpoint(endpoint),
    };
  }

  private buildDescription(req: SpecRequirement, specTitle: string): string {
    const lines = [
      req.description,
      '',
      '**Type:** ' + req.type,
      '**Priority:** ' + req.priority,
    ];

    if (req.acceptanceCriteria.length > 0) {
      lines.push('', '**Acceptance Criteria:**');
      for (const criterion of req.acceptanceCriteria) {
        lines.push(`- ${criterion}`);
      }
    }

    if (req.blockedBy && req.blockedBy.length > 0) {
      lines.push('', `**Blocked by:** ${req.blockedBy.join(', ')}`);
    }

    return lines.join('\n');
  }

  private mapRequirementType(type: SpecRequirement['type']): TaskType {
    switch (type) {
      case 'functional': return 'feature';
      case 'non-functional': return 'feature';
      case 'security': return 'feature';
      case 'performance': return 'feature';
      case 'ux': return 'feature';
      default: return 'feature';
    }
  }

  private mapPriority(priority: SpecRequirement['priority']): TaskPriority {
    switch (priority) {
      case 'critical': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      case 'low': return 'low';
      default: return 'medium';
    }
  }

  private estimateHours(req: SpecRequirement): number {
    switch (req.priority) {
      case 'critical': return 8;
      case 'high': return 4;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 2;
    }
  }

  private estimateForEndpoint(endpoint: NonNullable<Specification['apiEndpoints']>[number]): number {
    let hours = 2;
    if (endpoint.auth) hours += 1;
    if (endpoint.request) hours += 1;
    return hours;
  }

  async generateSubtasks(parentTaskId: string, spec: Specification): Promise<void> {
    const reqId = this.opts.taskTracker.getNode(parentTaskId)?.specRequirementId;
    if (!reqId) return;

    const req = spec.requirements.find((r) => r.id === reqId);
    if (!req) return;

    if (req.acceptanceCriteria.length > 0) {
      for (const criterion of req.acceptanceCriteria) {
        this.opts.taskTracker.addNode({
          title: criterion,
          description: `Verify: ${criterion}`,
          type: 'test',
          priority: 'medium',
          status: 'pending',
          parentId: parentTaskId,
        });
      }
    }
  }
}

export class DefaultTaskStore implements TaskStore {
  private graphs = new Map<string, TaskGraph>();

  async saveGraph(graph: TaskGraph): Promise<void> {
    this.graphs.set(graph.id, this.cloneGraph(graph));
  }

  async loadGraph(id: string): Promise<TaskGraph | null> {
    const g = this.graphs.get(id);
    return g ? this.cloneGraph(g) : null;
  }

  async listGraphs(): Promise<{ id: string; title: string; updatedAt: number }[]> {
    return Array.from(this.graphs.values()).map((g) => ({
      id: g.id,
      title: g.title,
      updatedAt: g.updatedAt,
    }));
  }

  async deleteGraph(id: string): Promise<void> {
    this.graphs.delete(id);
  }

  private cloneGraph(g: TaskGraph): TaskGraph {
    return {
      ...g,
      nodes: new Map(g.nodes),
      edges: [...g.edges],
      rootNodes: [...g.rootNodes],
    };
  }
}