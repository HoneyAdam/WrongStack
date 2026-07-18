import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SddWizard } from '../../src/components/SddWizard';
import { useSddWizardStore } from '../../src/stores/sdd-wizard-store';

const send = vi.hoisted(() => vi.fn());

vi.mock('@/i18n', () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ client: { send } }),
}));

vi.mock('@/hooks/useProviderModels', () => ({
  useProviderModels: () => [],
}));

vi.mock('@/hooks/useScrollPosition', () => ({
  useScrollPosition: () => ({ current: null }),
}));

describe('SddWizard run navigation', () => {
  beforeEach(() => {
    send.mockClear();
    useSddWizardStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useSddWizardStore.getState().reset();
  });

  it('hands a started run to its container and consumes the run marker', () => {
    const onRunStarted = vi.fn();
    render(<SddWizard onClose={vi.fn()} onRunStarted={onRunStarted} />);

    act(() => {
      useSddWizardStore.getState().setStartedRunId('run-1');
    });

    expect(onRunStarted).toHaveBeenCalledOnce();
    expect(useSddWizardStore.getState().startedRunId).toBeNull();
  });
});
