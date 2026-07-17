import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuperMemoryEntry } from '../../src/types.js';

type Message = { type: string; payload: unknown };
type Handler = (message: Message) => void;

const handlers = new Map<string, Set<Handler>>();
const sends: Array<{ type: string; payload?: unknown }> = [];

const client = {
  on(type: string, handler: Handler) {
    const registered = handlers.get(type) ?? new Set();
    registered.add(handler);
    handlers.set(type, registered);
    return () => registered.delete(handler);
  },
};

const websocket = {
  client,
  listSuperMemories: () => sends.push({ type: 'memory.super.list' }),
  rememberSuperMemory: (payload: unknown) => sends.push({ type: 'memory.super.remember', payload }),
  updateSuperMemory: (id: string, patch: unknown) =>
    sends.push({ type: 'memory.super.update', payload: { id, ...(patch as object) } }),
  deleteSuperMemory: (id: string, reason?: string) =>
    sends.push({ type: 'memory.super.delete', payload: { id, reason } }),
};

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => websocket,
}));

import { AudienceMemoryPanel } from '../../src/components/AudienceMemoryPanel.js';

const reviewerMemory: SuperMemoryEntry = {
  id: 'mem_reviewer',
  revision: 1,
  scope: 'project',
  kind: 'workflow',
  status: 'active',
  text: 'Check public API compatibility before approving a refactor.',
  importance: 0.8,
  confidence: 0.9,
  freshness: 1,
  tags: ['review'],
  anchors: [],
  audience: { roles: ['reviewer'], taskTypes: ['code-review'] },
  createdAt: '2026-07-16T08:00:00.000Z',
  updatedAt: '2026-07-16T08:00:00.000Z',
};

const teachingMemory: SuperMemoryEntry = {
  ...reviewerMemory,
  id: 'mem_teaching',
  kind: 'convention',
  text: 'Explain unfamiliar terms before using their abbreviations.',
  tags: ['teaching'],
  audience: { taskTypes: ['documentation'], modes: ['teach'] },
};

const generalMemory: SuperMemoryEntry = {
  ...reviewerMemory,
  id: 'mem_general',
  text: 'This record is general project memory.',
  audience: undefined,
};

function emit(type: string, payload: unknown) {
  act(() => {
    for (const handler of handlers.get(type) ?? []) handler({ type, payload });
  });
}

async function loadPanel() {
  render(<AudienceMemoryPanel />);
  expect(sends).toContainEqual({ type: 'memory.super.list' });
  emit('memory.super.list', {
    memories: [reviewerMemory, teachingMemory, generalMemory],
  });
  await screen.findByText(reviewerMemory.text);
}

beforeEach(() => {
  handlers.clear();
  sends.length = 0;
});

describe('AudienceMemoryPanel', () => {
  it('searches memory text and every audience selector, and supports badge filtering', async () => {
    await loadPanel();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search audience memories' }), {
      target: { value: 'teach' },
    });

    expect(screen.getByText(teachingMemory.text)).toBeTruthy();
    expect(screen.queryByText(reviewerMemory.text)).toBeNull();
    expect(screen.queryByText(generalMemory.text)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear audience memory search' }));
    fireEvent.click(screen.getByRole('button', { name: 'role:reviewer' }));

    expect(screen.getByText(reviewerMemory.text)).toBeTruthy();
    expect(screen.queryByText(teachingMemory.text)).toBeNull();
  });

  it('creates a scoped memory with an explicit kind and normalized selectors', async () => {
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    fireEvent.change(screen.getByLabelText('Memory'), {
      target: { value: 'Never expose raw provider credentials in diagnostic output.' },
    });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'warning' } });
    fireEvent.change(screen.getByLabelText('Roles'), {
      target: { value: ' reviewer, security-reviewer, reviewer ' },
    });
    fireEvent.change(screen.getByLabelText('Modes'), { target: { value: 'code-review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remember' }));

    expect(sends).toContainEqual({
      type: 'memory.super.remember',
      payload: {
        text: 'Never expose raw provider credentials in diagnostic output.',
        kind: 'warning',
        audience: {
          roles: ['reviewer', 'security-reviewer'],
          taskTypes: undefined,
          modes: ['code-review'],
        },
      },
    });
  });

  it('imports only valid audience-scoped entries from a JSON dialog', async () => {
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Import audience memories' }));

    fireEvent.change(screen.getByLabelText('JSON array'), {
      target: {
        value: JSON.stringify([
          {
            text: 'Prefer focused tests for review tasks.',
            kind: 'workflow',
            tags: ['testing'],
            audience: { roles: ['reviewer'] },
          },
          {
            text: 'Teach with a concrete example.',
            audience: { modes: ['teach'] },
            confidence: 0.9,
          },
          { text: 'Missing an audience selector.' },
        ]),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import memories' }));

    const imports = sends.filter((message) => message.type === 'memory.super.remember');
    expect(imports).toHaveLength(2);
    expect(imports[0]?.payload).toEqual({
      text: 'Prefer focused tests for review tasks.',
      kind: 'workflow',
      tags: ['testing'],
      audience: { roles: ['reviewer'], taskTypes: undefined, modes: undefined },
      importance: undefined,
      confidence: undefined,
    });
    expect(screen.getByRole('status').textContent).toContain('1 invalid entry was skipped');
  });

  it('uses the WebSocket actions for un-scoping and confirmed deletion', async () => {
    await loadPanel();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove audience scope from ${reviewerMemory.text.slice(0, 41)}…`,
      }),
    );
    expect(sends).toContainEqual({
      type: 'memory.super.update',
      payload: { id: reviewerMemory.id, audience: undefined },
    });

    fireEvent.click(
      screen.getByRole('button', { name: `Delete ${teachingMemory.text.slice(0, 41)}…` }),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete memory' }));

    expect(sends).toContainEqual({
      type: 'memory.super.delete',
      payload: {
        id: teachingMemory.id,
        reason: 'Removed from the audience memory panel.',
      },
    });

    emit('memory.super.delete', { success: true, message: 'Deleted.' });
    await waitFor(() => expect(screen.queryByText(teachingMemory.text)).toBeNull());
  });
});
