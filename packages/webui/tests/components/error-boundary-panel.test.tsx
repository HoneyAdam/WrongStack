import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

/** A child that always throws on render. */
function Boom({ message }: { message: string }) {
  throw new Error(message);
}

/** A child that renders normally. */
function Fine({ label }: { label: string }) {
  return <div data-testid="fine">{label}</div>;
}

describe('ErrorBoundary', () => {
  it('level="panel" isolates the crash: sibling content keeps rendering', () => {
    // Suppress the expected console.error from React's error logging.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <div>
        <Fine label="sibling-still-here" />
        <ErrorBoundary level="panel" name="TestPanel">
          <Boom message="boom-from-child" />
        </ErrorBoundary>
      </div>,
    );

    // The sibling outside the boundary must still be mounted.
    expect(screen.getByTestId('fine')).toBeTruthy();
    expect(screen.getByText('sibling-still-here')).toBeTruthy();

    // The panel fallback surfaces the panel name + error message.
    expect(screen.getByText(/TestPanel hit an error/)).toBeTruthy();
    expect(screen.getByText(/boom-from-child/)).toBeTruthy();

    spy.mockRestore();
  });

  it('level="app" renders the full-viewport recovery screen', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary level="app">
        <Boom message="app-boom" />
      </ErrorBoundary>,
    );

    // App-level fallback shows the Try Again + Reload buttons.
    const tryAgain = screen.getAllByText(/try again|Try again/i);
    expect(tryAgain.length).toBeGreaterThan(0);
    expect(screen.getByText(/app-boom/)).toBeTruthy();

    spy.mockRestore();
  });

  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary level="panel" name="TestPanel">
        <Fine label="happy-path" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('happy-path')).toBeTruthy();
  });
});
