import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDockInspector } from '../../src/components/WorkspaceDock.js';
import { useUIStore } from '../../src/stores/index.js';

describe('workspace dock inspector', () => {
  beforeEach(() => {
    useUIStore.setState({ dockSection: null, inspectorOpen: false });
  });

  afterEach(() => cleanup());

  it('shows selected dock content in the right-side inspector', async () => {
    render(<WorkspaceDockInspector sessionId="session-1" />);

    expect(screen.queryByTestId('workspace-dock-inspector')).toBeNull();
    act(() => useUIStore.getState().setDockSection('work'));

    expect(await screen.findByTestId('workspace-dock-inspector')).toBeDefined();
    expect(screen.getByText('Todos, tasks, and plan')).toBeDefined();
  });

  it('closes through the header action', async () => {
    useUIStore.getState().setDockSection('collab');
    render(<WorkspaceDockInspector sessionId="session-1" />);

    fireEvent.click(await screen.findByTestId('workspace-dock-inspector-close'));
    await waitFor(() => expect(useUIStore.getState().dockSection).toBeNull());
    expect(screen.queryByTestId('workspace-dock-inspector')).toBeNull();
  });

  it('closes on Escape', async () => {
    useUIStore.getState().setDockSection('work');
    render(<WorkspaceDockInspector sessionId="session-1" />);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(useUIStore.getState().dockSection).toBeNull());
  });
});
