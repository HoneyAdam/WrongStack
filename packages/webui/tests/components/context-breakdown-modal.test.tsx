import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextBreakdownModal } from '../../src/components/ContextBreakdownModal.js';

vi.mock('@/lib/ws-client', () => ({
  getWSClient: () => ({
    send: vi.fn(),
    on: vi.fn(() => vi.fn()),
  }),
}));

afterEach(cleanup);

describe('ContextBreakdownModal', () => {
  it('opens after initially rendering closed without changing the hook order', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ContextBreakdownModal open={false} onClose={onClose} />);

    expect(screen.queryByRole('dialog')).toBeNull();

    expect(() => {
      rerender(<ContextBreakdownModal open={true} onClose={onClose} />);
    }).not.toThrow();

    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
