import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityBar } from '../../src/components/activity-bar/index.js';
import { ThemeProvider } from '../../src/components/ThemeProvider.js';
import { useConfigStore } from '../../src/stores/config-store.js';

describe('ActivityBar connection indicator', () => {
  beforeEach(() => {
    useConfigStore.setState({ wsConnected: true });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  afterEach(cleanup);

  it('shows connected state as a compact corner icon', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ActivityBar />
      </ThemeProvider>,
    );

    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy();
  });
});
