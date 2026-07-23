import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KanbanBoard, KanbanTask } from '../src/types.js';
import {
  DEFAULT_ALLOWED_COMMANDS,
  DEFAULT_BLOCKED_COMMANDS,
  parseGitNumstat,
  validateCommand,
  VerificationContext,
} from '../src/verification/verification-context.js';

const roots: string[] = [];

function fixture(): { board: KanbanBoard; task: KanbanTask } {
  const now = '2026-07-23T00:00:00.000Z';
  const task: KanbanTask = {
    id: 'task-1',
    title: 'Verify release',
    columnId: 'review',
    order: 0,
    priority: 'high',
    status: 'review',
    createdAt: now,
    updatedAt: now,
  };
  const board: KanbanBoard = {
    id: 'board-1',
    title: 'Release',
    columns: [{ id: 'review', title: 'Review', order: 0, wipLimit: 0 }],
    tasks: [task],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  return { board, task };
}

async function context(root?: string): Promise<VerificationContext> {
  const projectRoot = root ?? (await mkdtemp(join(tmpdir(), 'verification-context-')));
  if (!root) roots.push(projectRoot);
  const { board, task } = fixture();
  return new VerificationContext({ projectRoot, board, task });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('VerificationContext command security', () => {
  it('keeps package managers and runtimes out of the generic allowlist', () => {
    const allow = new Set(DEFAULT_ALLOWED_COMMANDS);
    const block = new Set(DEFAULT_BLOCKED_COMMANDS);

    expect(validateCommand('pnpm vitest run', { allow, block, allowAll: false })).toContain(
      'blocked',
    );
    expect(validateCommand('node script.mjs', { allow, block, allowAll: true })).toContain(
      'blocked',
    );
  });

  it('rejects option-like test patterns before runner invocation', async () => {
    const result = await (await context()).runTest('--config=outside.ts');

    expect(result.failed).toBe(1);
    expect(result.failureOutput).toContain('option prefix');
  });

  it('reports a concrete failure when the selected pattern has no matching tests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verification-context-empty-'));
    roots.push(root);
    await writeFile(join(root, 'package.json'), '{"scripts":{}}\n');

    const result = await (await context(root)).runTest('tests/example.test.ts');

    expect(result.failed).toBe(1);
    expect(result.failureOutput).toBeTruthy();
  });
});

describe('parseGitNumstat', () => {
  it('preserves exact counts and classifies deletion-only entries', () => {
    expect(parseGitNumstat('5\t2\tsrc/changed.ts\n0\t9\tsrc/deleted.ts\n')).toEqual([
      {
        path: 'src/changed.ts',
        operation: 'modify',
        linesAdded: 5,
        linesRemoved: 2,
        hunks: 1,
      },
      {
        path: 'src/deleted.ts',
        operation: 'delete',
        linesAdded: 0,
        linesRemoved: 9,
        hunks: 1,
      },
    ]);
  });
});
