import { describe, it, expect } from 'vitest';
import { PhaseOrchestrator } from '../../src/autophase/phase-orchestrator.js';
import { PhaseGraphBuilder } from '../../src/autophase/phase-graph-builder.js';
import type { PhaseExecutionContext, PhaseGraph } from '../../src/autophase/types.js';
import type { TaskNode } from '../../src/types/task-graph.js';

describe('PhaseOrchestrator', () => {
  async function buildGraph(): Promise<PhaseGraph> {
    const builder = new PhaseGraphBuilder({
      title: 'Test Orchestrator',
      phases: [
        {
          name: 'Setup',
          description: 'Setup phase',
          priority: 'high',
          estimateHours: 1,
          parallelizable: false,
          taskTemplates: [
            { title: 'Task 1', description: 'First task', type: 'chore', priority: 'high', estimateHours: 0.5 },
            { title: 'Task 2', description: 'Second task', type: 'chore', priority: 'medium', estimateHours: 0.5 },
          ],
        },
        {
          name: 'Build',
          description: 'Build phase',
          priority: 'critical',
          estimateHours: 2,
          parallelizable: false,
          taskTemplates: [
            { title: 'Task 3', description: 'Third task', type: 'feature', priority: 'critical', estimateHours: 1 },
          ],
        },
      ],
    });
    return builder.build();
  }

  it('should start root phase and mark it running', async () => {
    const graph = await buildGraph();
    const executedTasks: string[] = [];

    const ctx: PhaseExecutionContext = {
      executeTask: async (task: TaskNode) => {
        executedTasks.push(task.title);
        await new Promise((r) => setTimeout(r, 10));
      },
    };

    const orchestrator = new PhaseOrchestrator({
      graph,
      ctx,
      autonomous: false,
      maxConcurrentTasks: 2,
    });

    await orchestrator.start();

    const phases = Array.from(graph.phases.values());
    expect(phases[0]!.status).toBe('completed');
    expect(phases[1]!.status).toBe('completed');
    expect(executedTasks).toContain('Task 1');
    expect(executedTasks).toContain('Task 2');
    expect(executedTasks).toContain('Task 3');
  });

  it('should calculate progress correctly', async () => {
    const graph = await buildGraph();

    const ctx: PhaseExecutionContext = {
      executeTask: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    };

    const orchestrator = new PhaseOrchestrator({
      graph,
      ctx,
      autonomous: false,
    });

    await orchestrator.start();

    const progress = orchestrator.getProgress();
    expect(progress.totalPhases).toBe(2);
    expect(progress.completed).toBe(2);
    expect(progress.percentComplete).toBe(100);
    expect(progress.totalTasks).toBe(3);
    expect(progress.completedTasks).toBe(3);
  });

  it('should support pause and resume', async () => {
    const graph = await buildGraph();

    const ctx: PhaseExecutionContext = {
      executeTask: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    };

    const orchestrator = new PhaseOrchestrator({
      graph,
      ctx,
      autonomous: false,
    });

    orchestrator.pause();
    expect(orchestrator.isPaused()).toBe(true);

    orchestrator.resume();
    expect(orchestrator.isPaused()).toBe(false);
  });

  it('should assign and release agents', async () => {
    const graph = await buildGraph();
    const phase = Array.from(graph.phases.values())[0]!;

    const orchestrator = new PhaseOrchestrator({
      graph,
      ctx: { executeTask: async () => {} },
      autonomous: false,
    });

    orchestrator.assignAgent(phase.id, 'agent-1');
    expect(phase.assignedAgents).toContain('agent-1');

    orchestrator.releaseAgent(phase.id, 'agent-1');
    expect(phase.assignedAgents).not.toContain('agent-1');
  });
});
