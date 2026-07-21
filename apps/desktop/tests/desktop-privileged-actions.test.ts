import type { TrustBoundary } from '@wrongstack/core/security';
import { describe, expect, it, vi } from 'vitest';
import { authorizeDesktopAction } from '../src/main/desktop-privileged-actions.js';

describe('Desktop privileged action adapter', () => {
  it('classifies native actions and preserves deny decisions', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const evaluate = vi.fn(async () => ({ kind: 'deny' as const, reason: 'blocked by policy' }));
    const boundary: TrustBoundary = { evaluate };

    const result = await authorizeDesktopAction(boundary, {
      capability: 'url.open-external',
      subject: { kind: 'url', id: 'https://example.test' },
      risk: 'elevated',
      metadata: { operation: 'test' },
    });

    expect(result).toEqual({ allowed: false, reason: 'blocked by policy' });
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'desktop',
        actor: { kind: 'user', id: 'desktop-user' },
        capability: 'url.open-external',
        subject: { kind: 'url', id: 'https://example.test' },
        authContext: { method: 'local-process', principalId: 'desktop-user' },
      }),
    );
  });
});
