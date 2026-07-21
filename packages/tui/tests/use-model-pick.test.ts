import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Text } from '../src/ink.js';
import { useModelPickRequest } from '../src/hooks/use-model-pick.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buildProviders() {
  return [
    { id: 'p1', family: 'OpenAI', models: ['gpt-4', 'gpt-3.5'] },
    { id: 'p2', family: 'Anthropic', models: ['claude-3'] },
  ];
}

describe('useModelPickRequest', () => {
  it('returns null when getPickableProviders is undefined', async () => {
    const dispatch = vi.fn();
    let hook: ReturnType<typeof useModelPickRequest> | null = null;

    function Harness(): React.ReactElement {
      hook = useModelPickRequest({ dispatch, pickerOpen: false });
      return React.createElement(Text, null, 'test');
    }

    render(React.createElement(Harness));
    const res = await hook!.requestModelPick('Pick');
    expect(res).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('handleModelPicked resolves the pending promise after getPickableProviders resolves', async () => {
    const dispatch = vi.fn();
    const getPickableProviders = vi.fn(async () => buildProviders());
    let hook: ReturnType<typeof useModelPickRequest> | null = null;

    function Harness(): React.ReactElement {
      hook = useModelPickRequest({ dispatch, getPickableProviders, pickerOpen: true });
      return React.createElement(Text, null, 'test');
    }

    render(React.createElement(Harness));

    // Start the async requestModelPick - it awaits getPickableProviders() internally
    const promise = hook!.requestModelPick('Pick');

    // Wait for getPickableProviders to resolve (it's mocked, so it resolves on next microtask)
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now resolverRef.current should be set
    hook!.handleModelPicked('p2', 'claude-3');
    const res = await promise;
    expect(res).toEqual({ providerId: 'p2', model: 'claude-3' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'modelPickerOpen',
      providers: buildProviders(),
      purpose: 'pick',
      title: 'Pick',
    });
  });

  it('handleModelPicked does nothing when no pending promise', () => {
    const dispatch = vi.fn();
    let hook: ReturnType<typeof useModelPickRequest> | null = null;

    function Harness(): React.ReactElement {
      hook = useModelPickRequest({ dispatch, pickerOpen: false });
      return React.createElement(Text, null, 'test');
    }

    render(React.createElement(Harness));
    expect(() => hook!.handleModelPicked('p1', 'gpt-4')).not.toThrow();
  });

  it('handleModelPicked has stable reference (empty deps)', () => {
    const dispatch = vi.fn();
    let hook1: ReturnType<typeof useModelPickRequest> | null = null;

    function Harness(): React.ReactElement {
      hook1 = useModelPickRequest({ dispatch, pickerOpen: false });
      return React.createElement(Text, null, 'test');
    }

    render(React.createElement(Harness));

    const ref1 = hook1!.handleModelPicked;
    const ref2 = hook1!.handleModelPicked;
    expect(ref1).toBe(ref2);
  });
});
