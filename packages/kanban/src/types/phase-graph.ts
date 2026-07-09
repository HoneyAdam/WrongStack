/**
 * Phase graph types — structural subset of @wrongstack/core's autophase types.
 * Defined locally so @wrongstack/kanban has no build dependency on core.
 */
import type { TaskGraph } from './task-graph.js';

export interface PhaseNode {
  id: string;
  name: string;
  description: string;
  status: string;
  taskGraph: TaskGraph;
  dependsOn: string[];
  nextPhases: string[];
  parallelizable: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimateHours: number;
  actualDurationMs?: number | undefined;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  assignedAgents: string[];
  metadata?: Record<string, unknown> | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface PhaseGraph {
  id: string;
  title: string;
  description: string;
  phases: Map<string, PhaseNode>;
  rootPhaseIds: string[];
  activePhaseIds: string[];
  completedPhaseIds: string[];
  createdAt: number;
  updatedAt: number;
}
