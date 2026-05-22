import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../../src/core/agent.js';
import { EternalAutonomyEngine } from '../../src/execution/eternal-autonomy.js';
import { EventBus } from '../../src/kernel/events.js';
import { emptyGoal, loadGoal, saveGoal } from '../../src/storage/goal-store.js';

interface MockAgentSetup {
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  runImpl?: (input: unknown) => Promise<{ status: string; iterations: number; finalText?: string }>;
  tokenCounter?: {
    total: () => { input: number; output: number };
    estimateCost: () => { total: number };
    currentRequestTokens?: () => { input: number; cacheRead: number };
  };
}

function makeMockAgent(setup: MockAgentSetup = {}): Agent {
  const events = new EventBus();
  const ctx = {
    todos: setup.todos ?? [],
    tokenCounter: setup.tokenCounter,
  } as any;
  const runMock = vi.fn(async (input: unknown) => {
    if (setup.runImpl) return setup.runImpl(input);
    return { status: 'done', iterations: 1, finalText: 'ok' };
  });
  return {
    run: runMock,
    register: vi.fn(),
    use: vi.fn(),
    container: null as any,
    tools: null as any,
    providers: null as any,
    events,
    pipelines: null as any,
    ctx,
  } as unknown as Agent;
}

function makeMockTokenCounter(seq: Array<{ input: number; output: number; cost: number; requestInput?: number }>): MockAgentSetup['tokenCounter'] {
  let i = 0;
  return {
    total: () => {
      const s = seq[Math.min(i, seq.length - 1)]!;
      return { input: s.input, output: s.output };
    },
    estimateCost: () => {
      const s = seq[Math.min(i, seq.length - 1)]!;
      // Advance the cursor only on the cost read, which is the last call
      // per iteration in the engine (snapshot order: total → cost).
      i++;
      return { total: s.cost };
    },
    currentRequestTokens: () => {
      const s = seq[Math.min(i, seq.length - 1)]!;
      return { input: s.requestInput ?? s.input, cacheRead: 0 };
    },
  };
}

describe('EternalAutonomyEngine', () => {
  let tmp: string;
  let projectRoot: string;
  let goalPath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-eternal-'));
    projectRoot = tmp;
    goalPath = path.join(projectRoot, '.wrongstack', 'goal.json');
    await fs.mkdir(path.join(projectRoot, '.wrongstack'), { recursive: true });
    await saveGoal(goalPath, emptyGoal('Make the project better'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('prefers pending todos as the iteration source', async () => {
    const agent = makeMockAgent({
      todos: [{ id: 't1', content: 'refactor parser', status: 'pending' }],
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });

    const ok = await engine.runOneIteration();
    expect(ok).toBe(true);
    // First and only agent.run call should have included the todo task text.
    const calls = (agent.run as any).mock.calls;
    expect(calls.length).toBe(1);
    const firstArg = calls[0][0];
    const directive = Array.isArray(firstArg) ? firstArg[0].text : String(firstArg);
    expect(directive).toContain('Source: todo');
    expect(directive).toContain('refactor parser');

    const after = await loadGoal(goalPath);
    expect(after?.iterations).toBe(1);
    expect(after?.journal[0]?.source).toBe('todo');
    expect(after?.journal[0]?.status).toBe('success');
  });

  it('falls back to git when no todos are pending', async () => {
    const agent = makeMockAgent({
      todos: [],
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => ' M packages/foo/bar.ts\n?? new-file.ts\n',
    });

    const ok = await engine.runOneIteration();
    expect(ok).toBe(true);
    const calls = (agent.run as any).mock.calls;
    const directive = Array.isArray(calls[0][0]) ? calls[0][0][0].text : String(calls[0][0]);
    expect(directive).toContain('Source: git');
    expect(directive).toContain('packages/foo/bar.ts');

    const after = await loadGoal(goalPath);
    expect(after?.journal[0]?.source).toBe('git');
  });

  it('brainstorms when todos and git are both clean', async () => {
    let firstCall = true;
    const agent = makeMockAgent({
      todos: [],
      runImpl: async () => {
        if (firstCall) {
          firstCall = false;
          // First call is the brainstorm prompt — return a proposed task.
          return { status: 'done', iterations: 1, finalText: 'Add CI workflow for releases' };
        }
        return { status: 'done', iterations: 1, finalText: 'executed' };
      },
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });

    const ok = await engine.runOneIteration();
    expect(ok).toBe(true);

    const calls = (agent.run as any).mock.calls;
    expect(calls.length).toBe(2); // brainstorm + execute
    const executeDirective = Array.isArray(calls[1][0]) ? calls[1][0][0].text : String(calls[1][0]);
    expect(executeDirective).toContain('Source: brainstorm');
    expect(executeDirective).toContain('Add CI workflow for releases');

    const after = await loadGoal(goalPath);
    expect(after?.journal[0]?.source).toBe('brainstorm');
  });

  it('records failures in the journal but keeps the engine alive', async () => {
    const agent = makeMockAgent({
      todos: [{ id: 't1', content: 'do thing', status: 'pending' }],
      runImpl: async () => ({
        status: 'failed',
        iterations: 1,
        error: { describe: () => 'provider unreachable' } as any,
      } as any),
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });

    const ok = await engine.runOneIteration();
    expect(ok).toBe(false);

    const after = await loadGoal(goalPath);
    expect(after?.journal[0]?.status).toBe('failure');
    expect(after?.journal[0]?.note).toContain('provider unreachable');
  });

  it('gracefully stops when the goal file disappears', async () => {
    const agent = makeMockAgent({});
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });
    // Simulate /goal clear by unlinking before the iteration starts.
    await fs.unlink(goalPath);

    const ok = await engine.runOneIteration();
    expect(ok).toBe(false);
    expect((agent.run as any).mock.calls.length).toBe(0);
  });

  it('captures per-iteration token + cost delta in the journal', async () => {
    const agent = makeMockAgent({
      todos: [{ id: 't1', content: 'do work', status: 'pending' }],
      // before-snapshot first, after-snapshot second.
      tokenCounter: makeMockTokenCounter([
        { input: 1000, output: 500, cost: 0.05 },
        { input: 1300, output: 650, cost: 0.07 },
      ]),
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });
    await engine.runOneIteration();
    const after = await loadGoal(goalPath);
    const entry = after?.journal[0];
    expect(entry?.tokens).toEqual({ input: 300, output: 150 });
    expect(entry?.costUsd).toBeCloseTo(0.02, 6);
  });

  it('runs cadence-based compaction after compactEveryNIterations succeeds', async () => {
    const agent = makeMockAgent({
      todos: [{ id: 't1', content: 'step', status: 'pending' }],
    });
    const compactor = {
      compact: vi.fn().mockResolvedValue({ before: 1000, after: 600, reductions: [] }),
    };
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
      compactor: compactor as any,
      compactEveryNIterations: 2,
    });

    await engine.runOneIteration(); // success #1
    await engine.runOneIteration(); // success #2 → cadence trip
    expect(compactor.compact).toHaveBeenCalledTimes(1);
    // Aggressive should be false on cadence trigger.
    expect(compactor.compact.mock.calls[0][1]).toEqual({ aggressive: false });

    const after = await loadGoal(goalPath);
    const compactEntry = after?.journal.find((e) => e.task.startsWith('compaction'));
    expect(compactEntry?.note).toContain('saved');
  });

  it('runs aggressive compaction when token usage crosses ratio', async () => {
    const agent = makeMockAgent({
      todos: [{ id: 't1', content: 'heavy work', status: 'pending' }],
      tokenCounter: makeMockTokenCounter([
        { input: 9000, output: 100, cost: 0.1, requestInput: 9000 },
        { input: 9100, output: 200, cost: 0.11, requestInput: 9100 },
      ]),
    });
    const compactor = {
      compact: vi.fn().mockResolvedValue({ before: 9100, after: 4000, reductions: [] }),
    };
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
      compactor: compactor as any,
      compactEveryNIterations: 100, // cadence shouldn't trip
      aggressiveCompactRatio: 0.85,
      maxContextTokens: 10_000,
    });

    await engine.runOneIteration();
    expect(compactor.compact).toHaveBeenCalledTimes(1);
    expect(compactor.compact.mock.calls[0][1]).toEqual({ aggressive: true });
  });

  it('does not compact when no compactor is wired', async () => {
    const agent = makeMockAgent({
      todos: [{ id: 't1', content: 'plain', status: 'pending' }],
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
      compactEveryNIterations: 1,
    });
    // No compactor — runOneIteration should succeed without throwing.
    const ok = await engine.runOneIteration();
    expect(ok).toBe(true);
  });

  it('prime() flips engineState on disk to running', async () => {
    const agent = makeMockAgent({});
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });
    await engine.prime();
    const after = await loadGoal(goalPath);
    expect(after?.engineState).toBe('running');
    expect(engine.currentState).toBe('running');
  });

  it('stop() flips engineState back to stopped on disk', async () => {
    const agent = makeMockAgent({});
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      gitStatusReader: async () => '',
    });
    await engine.prime();
    engine.stop();
    // Allow the fire-and-forget persistEngineState write to flush.
    await new Promise((r) => setTimeout(r, 50));
    const after = await loadGoal(goalPath);
    expect(after?.engineState).toBe('stopped');
    expect(engine.currentState).toBe('stopped');
  });

  it('resumes from a persisted goal across engine instances', async () => {
    // Iteration 1 with first engine instance — populates journal.
    const agentA = makeMockAgent({
      todos: [{ id: 't1', content: 'step A', status: 'pending' }],
    });
    const engineA = new EternalAutonomyEngine({
      agent: agentA,
      projectRoot,
      gitStatusReader: async () => '',
    });
    await engineA.runOneIteration();

    // Iteration 2 with a fresh engine instance — should see incremented counter.
    const agentB = makeMockAgent({
      todos: [{ id: 't2', content: 'step B', status: 'pending' }],
    });
    const engineB = new EternalAutonomyEngine({
      agent: agentB,
      projectRoot,
      gitStatusReader: async () => '',
    });
    await engineB.runOneIteration();

    const after = await loadGoal(goalPath);
    expect(after?.iterations).toBe(2);
    expect(after?.journal).toHaveLength(2);
    expect(after?.journal[0]?.task).toBe('step A');
    expect(after?.journal[1]?.task).toBe('step B');
  });

  it('forces brainstorm after consecutive failures', async () => {
    const todos = [{ id: 't1', content: 'broken thing', status: 'pending' as const }];
    let brainstormHit = false;
    const agent = makeMockAgent({
      todos,
      runImpl: async (input: unknown) => {
        const text = Array.isArray(input) && input[0] && 'text' in input[0] ? (input[0] as any).text : '';
        if (text.includes('You are deciding the next action')) {
          brainstormHit = true;
          return { status: 'done', iterations: 1, finalText: 'try a totally different path' };
        }
        // Always fail execute calls so the failure budget trips.
        return {
          status: 'failed',
          iterations: 1,
          error: { describe: () => 'boom' } as any,
        } as any;
      },
    });
    const engine = new EternalAutonomyEngine({
      agent,
      projectRoot,
      failureBudget: 2,
      gitStatusReader: async () => '',
    });

    await engine.runOneIteration(); // fail 1 (todo)
    await engine.runOneIteration(); // fail 2 (todo, budget hit on next decide)
    await engine.runOneIteration(); // should force brainstorm

    expect(brainstormHit).toBe(true);
    const after = await loadGoal(goalPath);
    const sources = after?.journal.map((e) => e.source) ?? [];
    expect(sources).toContain('brainstorm');
  });
});
