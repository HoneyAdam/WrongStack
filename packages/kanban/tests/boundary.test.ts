import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBoard,
  evaluateKanbanBoundaryOpaque,
  evaluateKanbanBoundaryPath,
  type KanbanBoundaryPolicy,
  mergeTasks,
  normalizeKanbanBoundaryPolicy,
  resolveKanbanBoundaryLayers,
  splitTask,
} from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const boardPolicy: KanbanBoundaryPolicy = {
  enabled: true,
  enforcement: 'confirm',
  shellAccess: 'confirm',
  allow: [
    { kind: 'package', path: 'packages/webui', access: 'read_write' },
    { kind: 'file', path: 'README.md', access: 'read' },
  ],
  deny: [{ kind: 'glob', path: 'packages/webui/**/*.secret', access: 'read_write' }],
};

describe('Kanban boundaries', () => {
  it('allows selected package paths and confirms outside paths', () => {
    const layers = resolveKanbanBoundaryLayers({ boundary: boardPolicy });
    expect(evaluateKanbanBoundaryPath(layers, 'packages/webui/src/App.tsx', 'write')).toEqual({
      decision: 'allow',
      path: 'packages/webui/src/App.tsx',
    });
    expect(evaluateKanbanBoundaryPath(layers, 'packages/tui/src/app.tsx', 'write')).toMatchObject({
      decision: 'confirm',
      source: 'board',
    });
  });

  it('combines board and task layers without allowing the task to widen the board', () => {
    const taskPolicy: KanbanBoundaryPolicy = {
      enabled: true,
      enforcement: 'block',
      shellAccess: 'block',
      allow: [{ kind: 'directory', path: 'packages/webui/src/components', access: 'write' }],
    };
    const layers = resolveKanbanBoundaryLayers({ boundary: boardPolicy }, { boundary: taskPolicy });
    expect(
      evaluateKanbanBoundaryPath(layers, 'packages/webui/src/components/KanbanView.tsx', 'write'),
    ).toMatchObject({ decision: 'allow' });
    expect(evaluateKanbanBoundaryPath(layers, 'packages/webui/src/App.tsx', 'write')).toMatchObject(
      {
        decision: 'block',
        source: 'task',
      },
    );
    expect(evaluateKanbanBoundaryPath(layers, 'packages/core/src/index.ts', 'write')).toMatchObject(
      {
        decision: 'block',
      },
    );
  });

  it('applies deny rules before allow rules and gates opaque tools', () => {
    const layers = resolveKanbanBoundaryLayers({ boundary: boardPolicy });
    expect(
      evaluateKanbanBoundaryPath(layers, 'packages/webui/src/token.secret', 'read'),
    ).toMatchObject({ decision: 'confirm', source: 'board' });
    expect(evaluateKanbanBoundaryPath(layers, 'packages/webui/token.secret', 'read')).toMatchObject(
      { decision: 'confirm', source: 'board' },
    );
    expect(evaluateKanbanBoundaryOpaque(layers, 'bash')).toMatchObject({
      decision: 'confirm',
      source: 'board',
    });
  });

  it('rejects absolute and upward-traversal selectors', () => {
    expect(() =>
      normalizeKanbanBoundaryPolicy({
        ...boardPolicy,
        allow: [{ kind: 'directory', path: '../outside', access: 'write' }],
      }),
    ).toThrow(/stay inside the project/);
    expect(() =>
      normalizeKanbanBoundaryPolicy({
        ...boardPolicy,
        allow: [{ kind: 'file', path: 'C:\\outside.txt', access: 'write' }],
      }),
    ).toThrow(/stay inside the project/);
  });

  it('rejects malformed policies received from untyped clients', () => {
    expect(() =>
      normalizeKanbanBoundaryPolicy({ ...boardPolicy, enabled: 'yes' } as never),
    ).toThrow(/enabled flag/);
    expect(() => normalizeKanbanBoundaryPolicy({ ...boardPolicy, allow: [null] } as never)).toThrow(
      /selectors must be objects/,
    );
  });

  it('preserves ceilings when tasks split and locks incompatible merged scopes', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'wstack-boundary-manager-'));
    roots.push(projectRoot);
    const narrowPolicy: KanbanBoundaryPolicy = {
      ...boardPolicy,
      allow: [{ kind: 'directory', path: 'packages/webui', access: 'read_write' }],
    };
    const otherPolicy: KanbanBoundaryPolicy = {
      ...boardPolicy,
      allow: [{ kind: 'directory', path: 'packages/tui', access: 'read_write' }],
    };
    const board = await createBoard(projectRoot, {
      title: 'Boundary lifecycle',
      tasks: [
        { title: 'Parent', boundary: narrowPolicy },
        { title: 'Web', boundary: narrowPolicy },
        { title: 'TUI', boundary: otherPolicy },
      ],
    });

    const split = await splitTask(projectRoot, board.id, board.tasks[0]!.id, {
      titles: ['Child'],
    });
    expect(split?.children[0]?.boundary).toEqual(narrowPolicy);

    const merged = await mergeTasks(projectRoot, board.id, {
      taskIds: [board.tasks[1]!.id, board.tasks[2]!.id],
      title: 'Needs explicit boundary review',
    });
    expect(merged?.task.boundary).toMatchObject({
      enabled: true,
      enforcement: 'block',
      shellAccess: 'block',
      allow: [{ path: '.wrongstack/boundary-review-required' }],
    });
  });
});
