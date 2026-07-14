import { describe, expect, it } from 'vitest';
import {
  buildTaskGraphFromAutophasePhase,
  buildTaskGraphFromSddSnapshot,
} from '../src/webui-server/kanban-run-mirror.js';

// Minimal SddBoardTask factory (only the fields the normalizer reads).
function sddTask(over: Record<string, unknown>) {
  return {
    id: 'n',
    shortId: 't00',
    title: 'task',
    description: '',
    status: 'pending',
    displayStatus: 'pending',
    priority: 'medium',
    type: 'feature',
    deps: [],
    retries: 0,
    ...over,
  };
}

function snapshot(tasks: Array<Record<string, unknown>>) {
  return {
    runId: 'sdd-1',
    graphId: 'g1',
    specId: 's1',
    title: 'Run',
    status: 'running',
    startedAt: 0,
    updatedAt: 1,
    progress: {},
    wave: 1,
    tasks,
    columns: [],
    // biome-ignore lint/suspicious/noExplicitAny: test fixture cast to the SDD type
  } as any;
}

describe('buildTaskGraphFromSddSnapshot', () => {
  it('keys nodes by real id, resolves shortId deps, carries runtime in metadata', () => {
    const g = buildTaskGraphFromSddSnapshot(
      snapshot([
        sddTask({ id: 'n1', shortId: 't01' }),
        sddTask({
          id: 'n2',
          shortId: 't02',
          deps: ['t01'],
          agentName: 'Curie',
          model: 'gpt-x',
          provider: 'openai',
          fallbackModels: ['m2'],
          worktreeBranch: 'wt/x',
          retries: 2,
          status: 'in_progress',
          displayStatus: 'in_progress',
        }),
      ]),
    );
    expect(g.id).toBe('g1');
    expect(g.specId).toBe('s1');
    expect((g.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(g.edges).toEqual([{ id: 'n1->n2', from: 'n1', to: 'n2', type: 'depends_on' }]);
    expect(g.rootNodes).toEqual(['n1']);
    const n2 = (g.nodes as Array<Record<string, unknown>>)[1];
    expect(n2.assignee).toBe('Curie');
    expect(n2.status).toBe('in_progress');
    expect(n2.metadata).toMatchObject({
      model: 'gpt-x',
      provider: 'openai',
      fallbackModels: ['m2'],
      worktreeBranch: 'wt/x',
      retries: 2,
    });
  });

  it('drops deps whose shortId is unknown and falls back rootNodes to first node', () => {
    const g = buildTaskGraphFromSddSnapshot(
      snapshot([sddTask({ id: 'n1', shortId: 't01', deps: ['tZZ'] })]),
    );
    expect(g.edges).toEqual([]);
    expect(g.rootNodes).toEqual(['n1']);
  });
});

describe('buildTaskGraphFromAutophasePhase', () => {
  it('stamps the RUN graphId and tags nodes with the phase name', () => {
    const g = buildTaskGraphFromAutophasePhase('graph1', 'My run', {
      id: 'phase-a',
      name: 'Design',
      tasks: [
        {
          id: 'p1',
          title: 'T1',
          status: 'in_progress',
          priority: 'high',
          type: 'feature',
          assignee: 'Bohr',
        },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
    } as any);
    expect(g.id).toBe('graph1'); // run graphId, NOT phase id
    expect((g.nodes as Array<{ id: string }>).length).toBe(1);
    const n = (g.nodes as Array<Record<string, unknown>>)[0];
    expect(n.tags).toEqual(['Design']);
    expect(n.assignee).toBe('Bohr');
    expect(n.status).toBe('in_progress');
  });
});
