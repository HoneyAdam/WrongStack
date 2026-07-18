import { beforeEach, describe, expect, it } from 'vitest';
import { useProviderStatusStore } from '../../src/stores/provider-status-store';

describe('provider status store', () => {
  beforeEach(() => useProviderStatusStore.getState().clear());

  it('keeps logical OmniRoute identities visible in the waiting room', () => {
    useProviderStatusStore.getState().update({
      providerId: 'cc',
      model: 'claude-opus-4.8',
      state: 'blocked',
      reason: 'quota_exhausted',
      updatedAt: 1,
      stateExpiresAt: 2,
    });

    expect(Object.values(useProviderStatusStore.getState().entries)).toEqual([
      expect.objectContaining({ providerId: 'cc', model: 'claude-opus-4.8' }),
    ]);
  });

  it('removes an entry when autonomous recovery marks it healthy', () => {
    const store = useProviderStatusStore.getState();
    store.update({
      providerId: 'cc',
      model: 'claude-opus-4.8',
      state: 'blocked',
      reason: 'quota_exhausted',
      updatedAt: 1,
    });
    useProviderStatusStore.getState().update({
      providerId: 'cc',
      model: 'claude-opus-4.8',
      state: 'healthy',
      reason: 'waiting_room_expired',
      updatedAt: 2,
    });

    expect(useProviderStatusStore.getState().entries).toEqual({});
  });

  it('hydrates blocked and degraded entries but omits healthy history', () => {
    useProviderStatusStore.getState().hydrate([
      { providerId: 'cc', model: 'opus', state: 'blocked', reason: 'quota', updatedAt: 1 },
      { providerId: 'openai', model: 'gpt', state: 'healthy', reason: 'ok', updatedAt: 1 },
    ]);

    expect(Object.values(useProviderStatusStore.getState().entries)).toHaveLength(1);
  });
});
