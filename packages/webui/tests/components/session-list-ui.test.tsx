import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionList } from '../../src/components/SidePanel/SessionList';
import { i18n } from '../../src/i18n';
import type { SessionHistoryEntry } from '../../src/stores';
import { useUIStore } from '../../src/stores';

function entry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    id: 'session-1',
    title: 'Rebuild the WebUI',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    endedAt: new Date().toISOString(),
    model: 'claude-sonnet',
    provider: 'anthropic',
    tokenTotal: 1_250,
    toolCallCount: 6,
    fileChangeCount: 3,
    outcome: 'completed',
    isCurrent: false,
    ...overrides,
  };
}

describe('SessionList workspace', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useUIStore.setState({ favoriteSessionIds: [], sessionNicknames: {} });
  });

  afterEach(() => cleanup());

  function renderWorkspace(overrides: Partial<ComponentProps<typeof SessionList>> = {}) {
    const props: ComponentProps<typeof SessionList> = {
      historyQuery: '',
      setHistoryQuery: vi.fn(),
      historyEntries: [entry()],
      historyLoading: false,
      historyError: null,
      wsConnected: true,
      listSessions: vi.fn(),
      resumeSession: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      variant: 'workspace',
      ...overrides,
    };
    render(<SessionList {...props} />);
    return props;
  }

  it('renders operational stats, persistent search and history filters', () => {
    renderWorkspace();
    expect(screen.getByLabelText('Filter title, model, provider…')).toBeDefined();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Tool calls')).toBeDefined();
    expect(screen.getByText('Files changed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
  });

  it('keeps rename editing outside the resume button and persists on Enter', () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByTitle('Rename'));
    const input = screen.getByLabelText('Session name');
    expect(input.closest('button')).toBeNull();
    fireEvent.change(input, { target: { value: 'Operator history' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.renameSession).toHaveBeenCalledWith('session-1', 'Operator history');
  });

  it('pins locally and resumes through an explicit workspace action', () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByTitle('Mark as favorite'));
    expect(useUIStore.getState().favoriteSessionIds).toEqual(['session-1']);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(props.resumeSession).toHaveBeenCalledWith('session-1');
  });
});
