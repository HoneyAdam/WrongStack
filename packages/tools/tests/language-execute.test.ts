import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMocks = vi.hoisted(() => ({ spawnStream: vi.fn() }));
vi.mock('../src/_spawn-stream.js', async (original) => {
  const actual = (await original()) as Record<string, unknown>;
  return { ...actual, spawnStream: spawnMocks.spawnStream };
});

import { executeLanguagePlan } from '../src/languages/execute.js';
import { planLanguageOperation } from '../src/languages/plan.js';
import type { CommandPlan, DetectedWorkspace } from '../src/languages/types.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-language-execute-'));
  spawnMocks.spawnStream.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function collect(
  workspace: DetectedWorkspace,
  plan: CommandPlan,
  signal = new AbortController().signal,
) {
  const stream = executeLanguagePlan({ projectRoot: root, workspace, plan, signal });
  const progress = [];
  for (;;) {
    const next = await stream.next();
    if (next.done) return { result: next.value, progress };
    progress.push(next.value);
  }
}

function fakeSpawn(stdout: string, stderr = '', exitCode = 0, error?: string) {
  return async function* () {
    yield { type: 'partial_output', text: stdout } as const;
    return { stdout, stderr, exitCode, truncated: false, ...(error ? { error } : {}) };
  };
}

describe('executeLanguagePlan', () => {
  it('executes an internal TypeScript syntax plan without spawning', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}');
    const target = path.join(root, 'bad.ts');
    await fs.writeFile(target, 'const x = ;');
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'typescript',
      operation: 'syntax',
      target,
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));
    const { result } = await collect(planned.workspace, planned.plan);
    expect(result.status).toBe('failed');
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(spawnMocks.spawnStream).not.toHaveBeenCalled();
  });

  it('executes a process plan, streams progress, and normalizes diagnostics', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x');
    spawnMocks.spawnStream.mockImplementation(fakeSpawn('main.go:4:2: undefined: x', '', 1));
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'go',
      operation: 'semantic',
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));
    const { result, progress } = await collect(planned.workspace, planned.plan);
    expect(spawnMocks.spawnStream).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: 'go', args: ['test', '-run', '^$', './...'], cwd: root }),
    );
    expect(progress.some((item) => item.type === 'partial_output')).toBe(true);
    expect(result).toMatchObject({ status: 'failed', exitCode: 1, summary: { errors: 1 } });
    expect(result.diagnostics[0]).toMatchObject({
      file: path.join(root, 'main.go'),
      range: { start: { line: 4, column: 2 } },
    });
  });

  it('rejects tampered executables before spawning', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x');
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'go',
      operation: 'test',
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));
    const tampered = { ...planned.plan, command: 'calc' } as CommandPlan;
    const { result } = await collect(planned.workspace, tampered);
    expect(result).toMatchObject({
      status: 'unavailable',
      error: expect.stringMatching(/allowlisted/),
    });
    expect(spawnMocks.spawnStream).not.toHaveBeenCalled();
  });

  it('rejects package/network plans in Phase 2', async () => {
    await fs.writeFile(path.join(root, 'Cargo.toml'), '[package]');
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'rust',
      operation: 'package-install',
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));
    const { result } = await collect(planned.workspace, planned.plan);
    expect(result).toMatchObject({
      status: 'unavailable',
      error: expect.stringMatching(/Phase 3/),
    });
  });

  it('classifies cancellation and timeout distinctly', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x');
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'go',
      operation: 'test',
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));

    spawnMocks.spawnStream.mockImplementation(({ signal }: { signal: AbortSignal }) =>
      (async function* () {
        await new Promise<void>((_resolve, reject) => {
          const fail = () => reject(signal.reason ?? new Error('aborted'));
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        });
        return { stdout: '', stderr: '', exitCode: 124, truncated: false };
      })(),
    );

    const cancelledController = new AbortController();
    cancelledController.abort(new Error('cancelled by test'));
    const cancelled = await collect(planned.workspace, planned.plan, cancelledController.signal);
    expect(cancelled.result.status).toBe('cancelled');

    const timeoutPlan = { ...planned.plan, timeoutMs: 1 } as CommandPlan;
    const timedOut = await collect(planned.workspace, timeoutPlan);
    expect(timedOut.result.status).toBe('timed_out');
  });

  it('rejects plan cwd that resolves outside the project root', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x');
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'go',
      operation: 'test',
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));
    const tampered = { ...planned.plan, cwd: path.dirname(root) } as CommandPlan;
    const { result } = await collect(planned.workspace, tampered);
    expect(result.status).toBe('unavailable');
    expect(result.error).toMatch(/outside project root/);
    expect(spawnMocks.spawnStream).not.toHaveBeenCalled();
  });

  it('classifies missing executables as unavailable', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module x');
    spawnMocks.spawnStream.mockImplementation(fakeSpawn('', '', 1, 'spawn go ENOENT'));
    const planned = await planLanguageOperation({
      projectRoot: root,
      language: 'go',
      operation: 'test',
    });
    if (planned.status !== 'planned') throw new Error(JSON.stringify(planned));
    const { result } = await collect(planned.workspace, planned.plan);
    expect(result.status).toBe('unavailable');
  });
});
