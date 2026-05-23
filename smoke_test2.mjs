// Inline smoke test for parallel-eternal-engine
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function writeGoalFile(goalPath) {
  await writeFile(goalPath, JSON.stringify({
    version: 1,
    goal: 'smoke test goal',
    setAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    iterations: 0,
    engineState: 'idle',
    goalState: 'active',
    todoAttempts: {},
    journal: [],
  }), 'utf-8');
}

const { ParallelEternalEngine } = await import('./packages/core/src/execution/parallel-eternal-engine.js');

const tmp = await mkdtemp(path.join(tmpdir(), 'ws-parallel-smoke-'));
const goalPath = path.join(tmp, '.wrongstack', 'goal.json');
await mkdir(path.join(tmp, '.wrongstack'), { recursive: true });
await writeGoalFile(goalPath);

// Minimal mock agent
function makeMockAgent() {
  return {
    ctx: {
      todos: [],
      provider: null,
      model: 'test',
      messages: [],
      systemPrompt: '',
      signal: new AbortController().signal,
      session: { append: () => {}, close: () => {} },
      state: {},
      tokenCounter: { currentRequestTokens: () => ({ input: 100, output: 50, cacheRead: 0 }) },
      modeStore: { get: () => 'standard', set: () => {} },
      registerAbortHook: () => {},
      drainAbortHooks: () => {},
      isDisposed: false,
    },
    run: async () => ({ status: 'done', finalText: 'DONE', iterations: 1, toolCalls: 0 }),
    events: { emit: () => {}, on: () => {}, off: () => {} },
    container: { resolve: () => {} },
    tools: { register: () => {}, all: () => [] },
    providers: { all: () => [], default: () => null },
  };
}

const engine = new ParallelEternalEngine({ agent: makeMockAgent(), projectRoot: tmp });
console.log('state:', engine.currentState);
console.log('PASSED: engine instantiates and state is idle');