import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-audience-memory-'));
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe('project agent memory audiences', () => {
  it('matches stable roles across independent store instances', async () => {
    const writer = new SuperMemoryStore({ projectRoot });
    const created = await writer.rememberSuper({
      text: 'Review public API compatibility before approving changes.',
      kind: 'workflow',
      scope: 'project',
      audience: { roles: [' Reviewer ', 'reviewer'] },
    });

    const reader = new SuperMemoryStore({ projectRoot });
    const reviewer = await reader.retrieveForAudience({ role: 'REVIEWER' });
    const refactorPlanner = await reader.retrieveForAudience({ role: 'refactor-planner' });

    expect(reviewer.map((memory) => memory.id)).toEqual([created.id]);
    expect(reviewer[0]?.audience).toEqual({ roles: ['reviewer'] });
    expect(refactorPlanner).toEqual([]);
  });

  it('uses OR within a selector dimension and AND across dimensions', async () => {
    const store = new SuperMemoryStore({ projectRoot });
    await store.rememberSuper({
      text: 'For review-mode refactors, inspect ownership boundaries first.',
      scope: 'project',
      audience: {
        roles: ['reviewer', 'refactor-planner'],
        taskTypes: ['refactor'],
        modes: ['strict-review'],
      },
    });

    expect(await store.retrieveForAudience({
      role: 'refactor-planner',
      taskType: 'refactor',
      mode: 'strict-review',
    })).toHaveLength(1);
    expect(await store.retrieveForAudience({
      role: 'reviewer',
      taskType: 'bugfix',
      mode: 'strict-review',
    })).toEqual([]);
    expect(await store.retrieveForAudience({ role: 'reviewer', taskType: 'refactor' })).toEqual([]);
  });

  it('keeps scoped policy out of ordinary automatic retrieval while explicit search remains complete', async () => {
    const store = new SuperMemoryStore({ projectRoot });
    await store.rememberSuper({
      text: 'Review database migrations for reversible rollbacks.',
      scope: 'project',
      audience: { roles: ['reviewer'] },
      anchors: [{ type: 'directory', path: 'packages/core' }],
    });
    await store.rememberSuper({
      text: 'Database migrations live in the core package.',
      scope: 'project',
      anchors: [{ type: 'directory', path: 'packages/core' }],
    });

    const explicit = await store.searchSuper('database migrations');
    const automatic = await store.searchSuper('database migrations', {
      includeAudienceScoped: false,
    });
    const automaticPath = await store.retrieveForPath({
      path: 'packages/core/src/index.ts',
      includeAudienceScoped: false,
    });

    expect(explicit).toHaveLength(2);
    expect(automatic.map((memory) => memory.text)).toEqual([
      'Database migrations live in the core package.',
    ]);
    expect(automaticPath.map((memory) => memory.text)).toEqual([
      'Database migrations live in the core package.',
    ]);
  });

  it('does not merge identical text belonging to different roles', async () => {
    const store = new SuperMemoryStore({ projectRoot });
    const reviewer = await store.rememberSuper({
      text: 'Check the package boundary.',
      audience: { roles: ['reviewer'] },
    });
    const git = await store.rememberSuper({
      text: 'Check the package boundary.',
      audience: { roles: ['git'] },
    });

    expect(git.id).not.toBe(reviewer.id);
    expect(await store.retrieveForAudience({ role: 'reviewer' })).toHaveLength(1);
    expect(await store.retrieveForAudience({ role: 'git' })).toHaveLength(1);
  });
});
