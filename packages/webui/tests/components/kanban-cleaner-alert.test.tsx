import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanCleanerAlert } from '../../src/components/KanbanCleanerAlert.js';
import type { KanbanAuditSummary } from '../../src/lib/kanban-cleaner.js';

const audit: KanbanAuditSummary = {
  issues: [
    {
      id: 'task-1:stale-running-task',
      taskId: 'task-1',
      taskTitle: 'Repair lease',
      code: 'stale-running-task',
      severity: 'error',
      message: 'Assignment lease is expired',
    },
    {
      id: 'task-1:missing-labels',
      taskId: 'task-1',
      taskTitle: 'Repair lease',
      code: 'missing-labels',
      severity: 'warning',
      message: 'Add labels or tags',
    },
    {
      id: 'task-2:stale-review',
      taskId: 'task-2',
      taskTitle: 'Approve release',
      code: 'stale-review',
      severity: 'warning',
      message: 'Waiting in review for 8h',
    },
  ],
  counts: { error: 1, warning: 2 },
  affectedTaskCount: 2,
};

describe('KanbanCleanerAlert', () => {
  it('renders severity counts and groups concise issues by card', () => {
    render(<KanbanCleanerAlert audit={audit} onSelectTask={vi.fn()} />);

    expect(screen.getByText('Kanban Cleaner found 3 issues')).toBeTruthy();
    expect(screen.getByText('1 critical')).toBeTruthy();
    expect(screen.getByText('2 warning')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Open Repair lease/ })).toHaveLength(1);
    expect(screen.getByText(/Assignment lease is expired · Add labels or tags/)).toBeTruthy();
  });

  it('opens the selected card when an issue group is clicked', () => {
    const onSelectTask = vi.fn();
    render(<KanbanCleanerAlert audit={audit} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByRole('button', { name: /Open Approve release/ }));

    expect(onSelectTask).toHaveBeenCalledWith('task-2');
  });

  it('exposes an accessible expand/collapse control', () => {
    render(<KanbanCleanerAlert audit={audit} onSelectTask={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Collapse Kanban Cleaner issues' });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);

    expect(screen.queryByRole('button', { name: /Open Repair lease/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Expand Kanban Cleaner issues' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('renders nothing for a clean board', () => {
    const { container } = render(
      <KanbanCleanerAlert
        audit={{ issues: [], counts: { error: 0, warning: 0 }, affectedTaskCount: 0 }}
        onSelectTask={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
