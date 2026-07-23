// @vitest-environment jsdom

import { render } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Action, State } from '../src/app-reducer.js';
import { useDirectorFleetBridge } from '../src/hooks/use-director-fleet-bridge.js';
import { createTestState } from './helpers/create-test-state.js';

describe('useDirectorFleetBridge lifecycle', () => {
  it('does not resubscribe or dispatch cost after an unrelated parent render', () => {
    const offFleet = vi.fn();
    const offDone = vi.fn();
    const onAny = vi.fn(() => offFleet);
    const on = vi.fn(() => offDone);
    const snapshot = vi.fn(() => ({
      total: { cost: 0, input: 0, output: 0 },
      perSubagent: {},
    }));
    const director = {
      status: () => ({ subagents: [] }),
      snapshot,
      getSubagentMeta: () => undefined,
      fleet: { onAny },
      on,
    } as never;
    const actions: Action[] = [];
    const dispatch = (action: Action): void => {
      actions.push(action);
    };
    const stateRef = { current: createTestState() as State };

    function Harness({ unrelated }: { unrelated: number }): React.ReactElement {
      useDirectorFleetBridge({
        director,
        dispatch,
        stateRef,
        chatMode: 'full',
      });
      return <span>{unrelated}</span>;
    }

    const view = render(<Harness unrelated={0} />);
    expect(onAny).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([
      {
        type: 'fleetCost',
        cost: 0,
        input: 0,
        output: 0,
        perAgent: {},
      },
    ]);

    actions.length = 0;
    view.rerender(<Harness unrelated={1} />);

    expect(onAny).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(offFleet).not.toHaveBeenCalled();
    expect(offDone).not.toHaveBeenCalled();
    expect(actions).toEqual([]);

    view.unmount();
    expect(offFleet).toHaveBeenCalledTimes(1);
    expect(offDone).toHaveBeenCalledTimes(1);
  });
});
