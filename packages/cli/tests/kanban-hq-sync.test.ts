import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HqKanbanSnapshotPayload, HqPublisher } from '@wrongstack/core/hq';
import { createBoardObject, readBoard, writeBoard } from '@wrongstack/kanban';
import { createKanbanHqSync } from '../src/kanban-hq-sync.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.useRealTimers();
});

async function tempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-hq-client-'));
  roots.push(root);
  return root;
}

describe('CLI Kanban HQ synchronization', () => {
  it('publishes local boards on attach', async () => {
    const root = await tempProject();
    const board = createBoardObject({ title: 'Local' });
    await writeBoard(root, board);
    const publishEvent = vi.fn();
    const sync = createKanbanHqSync(root);

    await sync.attachPublisher({ publishEvent } as unknown as HqPublisher);

    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'kanban.snapshot',
        payload: expect.objectContaining({
          boards: [expect.objectContaining({ boardId: board.id, revision: 0 })],
        }),
      }),
    );
    sync.stop();
  });

  it('serializes simultaneous initial publish and remote snapshot state writes', async () => {
    const root = await tempProject();
    const publishEvent = vi.fn();
    const sync = createKanbanHqSync(root, 'shared-project');
    const remote: HqKanbanSnapshotPayload = {
      projectId: 'shared-project',
      generatedAt: '2026-07-22T12:00:00Z',
      boards: [],
      tombstones: [],
    };

    await Promise.all([
      sync.attachPublisher({ publishEvent } as unknown as HqPublisher),
      sync.handleRemote(remote),
    ]);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    await expect(
      fs.readFile(path.join(root, '.wrongstack', 'kanbans', '.hq-sync.json'), 'utf8'),
    ).resolves.toContain('"boards"');
    sync.stop();
  });

  it('applies newer HQ boards but preserves newer local revisions', async () => {
    const root = await tempProject();
    const local = createBoardObject({ title: 'Local' });
    local.revision = 3;
    local.updatedAt = '2026-07-22T12:03:00Z';
    await writeBoard(root, local);
    const sync = createKanbanHqSync(root);

    const payload = (revision: number, title: string): HqKanbanSnapshotPayload => ({
      projectId: projectId(root),
      generatedAt: '2026-07-22T12:05:00Z',
      boards: [
        {
          boardId: local.id,
          revision,
          updatedAt: `2026-07-22T12:0${revision}:00Z`,
          board: { ...local, revision, title, updatedAt: `2026-07-22T12:0${revision}:00Z` },
        },
      ],
      tombstones: [],
    });

    await sync.handleRemote(payload(2, 'Stale'));
    expect((await readBoard(root, local.id))?.title).toBe('Local');
    await sync.handleRemote(payload(4, 'Remote'));
    expect((await readBoard(root, local.id))?.title).toBe('Remote');
    sync.stop();
  });
});

function projectId(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 12);
}
