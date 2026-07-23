/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HqKanbanSnapshotPayload, HqSnapshot } from '@wrongstack/core/hq';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock('../src/store.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, fetchJson: fetchJsonMock };
});

import { useHqStore } from '../src/store.js';
import { KanbanView } from '../src/views/kanban.js';

const PROJECT_ID = 'proj_01KY5W8B8YQVCTFZ1CAEVT5HM2';
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const payload: HqKanbanSnapshotPayload = {
  projectId: PROJECT_ID,
  generatedAt: '2026-07-23T10:00:00.000Z',
  boards: [
    {
      boardId: 'board-1',
      revision: 3,
      updatedAt: '2026-07-23T09:00:00.000Z',
      board: {
        id: 'board-1',
        title: 'Shared Delivery',
        description: 'Release coordination',
        columns: [
          { id: 'todo', title: 'Todo', order: 0 },
          { id: 'doing', title: 'Doing', order: 1 },
          { id: 'done', title: 'Done', order: 2 },
        ],
        tasks: [
          {
            id: 't2',
            title: 'Ship UI',
            columnId: 'doing',
            order: 0,
            priority: 'high',
            status: 'in_progress',
            assignee: 'agent-a',
          },
          {
            id: 't1',
            title: 'Identity',
            columnId: 'done',
            order: 0,
            priority: 'medium',
            status: 'completed',
          },
        ],
      },
    },
  ],
  tombstones: [],
};

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue(payload);
  useHqStore.setState({
    snapshot: {
      projects: [
        {
          projectId: PROJECT_ID,
          projectName: 'WrongStack',
          projectRootDisplay: 'D:/Codebox/PROJECTS/WrongStack',
          machineIds: ['machine-1'],
          activeClients: 1,
          activeSessions: 1,
          activeSubagents: 0,
          totalCostUsd: 0,
          lastActivityAt: '2026-07-23T10:00:00.000Z',
          status: 'active',
        },
      ],
      clients: [],
      machines: [],
      liveSessions: [],
      totals: {
        activeSessions: 1,
        activeAgents: 1,
        totalCostUsd: 0,
      },
    } as unknown as HqSnapshot,
    events: [],
    alerts: [],
    selectedClientId: null,
    connected: true,
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

async function mountKanban(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(KanbanView));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('HQ Kanban view', () => {
  it('loads and renders the shared project board', async () => {
    await mountKanban();

    expect(fetchJsonMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/kanban`);
    expect(container?.textContent).toContain('Shared Delivery');
    expect(container?.textContent).toContain('Todo');
    expect(container?.textContent).toContain('Ship UI');
    expect(container?.textContent).toContain('Identity');
    expect(container?.textContent).toContain('agent-a');
  });

  it('refreshes when HQ receives a Kanban snapshot event', async () => {
    await mountKanban();
    const initialCalls = fetchJsonMock.mock.calls.length;

    await act(async () => {
      useHqStore.setState((state) => ({
        events: [
          ...state.events,
          {
            id: 'evt-kanban-1',
            type: 'kanban.snapshot',
            schemaVersion: 1,
            timestamp: '2026-07-23T10:01:00.000Z',
            clientId: 'client-1',
            projectId: PROJECT_ID,
            seq: 1,
            payload: {},
          },
        ],
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchJsonMock.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
