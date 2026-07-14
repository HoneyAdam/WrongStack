import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InspectorPanel, InspectorTrigger } from '../../src/components/InspectorPanel.js';
import { useFleetStore, useSideEffectStore, useUIStore } from '../../src/stores/index.js';

describe('global inspector drawer', () => {
  beforeEach(() => {
    useFleetStore.getState().clear();
    useSideEffectStore.getState().clear();
    useUIStore.setState({ inspectorOpen: false, inspectorTab: 'fleet' });
  });

  afterEach(() => cleanup());

  function renderInspector() {
    render(
      <>
        <InspectorTrigger />
        <InspectorPanel />
      </>,
    );
  }

  it('opens from the shell trigger and exposes all consolidated tabs', async () => {
    renderInspector();

    const trigger = screen.getByTestId('inspector-trigger');
    fireEvent.click(trigger);

    expect(await screen.findByTestId('inspector-drawer')).toBeDefined();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Fleet' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Agents' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Audit' })).toBeDefined();

    fireEvent.click(screen.getByTestId('inspector-close'));
    await waitFor(() => expect(useUIStore.getState().inspectorOpen).toBe(false));
  });

  it('keeps the active tab in shared UI state', async () => {
    renderInspector();
    fireEvent.click(screen.getByTestId('inspector-trigger'));

    const auditTab = await screen.findByRole('tab', { name: 'Audit' });
    fireEvent.keyDown(auditTab, { key: 'Enter' });

    await waitFor(() => expect(useUIStore.getState().inspectorTab).toBe('sideEffects'));
    expect(auditTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByTestId('inspector-close'));
    await waitFor(() => expect(useUIStore.getState().inspectorOpen).toBe(false));
  });

  it('closes through the labelled action and restores focus to the trigger', async () => {
    renderInspector();
    const trigger = screen.getByTestId('inspector-trigger');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('inspector-close'));

    await waitFor(() => expect(screen.queryByTestId('inspector-drawer')).toBeNull());
    expect(useUIStore.getState().inspectorOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
