import React from 'react';
import { render } from 'ink-testing-library';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Text } from '../src/ink.js';
import type { Context } from '@wrongstack/core';
import { formatWorkingDirChip, useWorkingDirChip } from '../src/hooks/use-working-dir-chip.js';

// ── formatWorkingDirChip (pure) ──────────────────────────────────────

describe('formatWorkingDirChip', () => {
  it('returns undefined for empty, root, and current-project paths', () => {
    expect(formatWorkingDirChip(undefined, '/repo')).toBeUndefined();
    expect(formatWorkingDirChip('/repo', '/repo')).toBeUndefined();
    expect(formatWorkingDirChip('/repo/.', '/repo/.')).toBeUndefined();
  });

  it('returns a normalized relative path for subdirectories inside the project', () => {
    expect(formatWorkingDirChip('/repo/src/utils', '/repo')).toBe('src/utils');
  });

  // #249: this test uses Windows-style paths (backslash separators), which only
  // path.win32 handles correctly. Skip on non-Windows runners.
  it.skipIf(process.platform !== 'win32')(
    'normalizes Windows-style separators to forward slashes for display',
    () => {
      expect(formatWorkingDirChip('C:\\repo\\src\\utils', 'C:\\repo')).toBe('src/utils');
    },
  );

  it('normalizes a relative root marker back to undefined', () => {
    expect(formatWorkingDirChip('/repo/', '/repo')).toBeUndefined();
  });

  it('handles working dir inside a deep path structure', () => {
    expect(formatWorkingDirChip('/project/a/b/c/d', '/project')).toBe('a/b/c/d');
  });

  it('uses win32 when paths contain backslashes on any OS', () => {
    expect(formatWorkingDirChip('C:\\project\\src', 'C:\\project')).toBe('src');
  });
});

// ── useWorkingDirChip (hook) ─────────────────────────────────────────

function makeContext(overrides?: Partial<Context>): Context {
  return {
    workingDir: '/project/src',
    onWorkingDirChanged: vi.fn(() => vi.fn()),
    ...overrides,
  } as unknown as Context;
}

describe('useWorkingDirChip', () => {
  it('returns undefined when workingDir equals projectRoot', () => {
    let result: string | undefined = 'initial';
    function Harness(): React.ReactElement {
      result = useWorkingDirChip(makeContext({ workingDir: '/project' }), '/project');
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(result).toBeUndefined();
  });

  it('returns formatted chip from initial state', () => {
    let result: string | undefined;
    function Harness(): React.ReactElement {
      result = useWorkingDirChip(makeContext({ workingDir: '/project/src' }), '/project');
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(result).toBe('src');
  });

  it('subscribes to onWorkingDirChanged and updates chip', () => {
    const listeners: Array<(newDir: string) => void> = [];
    const onWorkingDirChanged = vi.fn((listener: (newDir: string) => void) => {
      listeners.push(listener);
      return vi.fn();
    });
    const ctx = makeContext({
      workingDir: '/project/src',
      onWorkingDirChanged,
    });

    let result: string | undefined;
    function Harness(): React.ReactElement {
      result = useWorkingDirChip(ctx, '/project');
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(result).toBe('src');

    // Simulate working dir change
    act(() => {
      for (const listener of listeners) {
        listener('/project/docs');
      }
    });

    expect(result).toBe('docs');
  });

  it('returns undefined when working dir changes to project root', () => {
    const listeners: Array<(newDir: string) => void> = [];
    const onWorkingDirChanged = vi.fn((listener: (newDir: string) => void) => {
      listeners.push(listener);
      return vi.fn();
    });
    const ctx = makeContext({
      workingDir: '/project/src',
      onWorkingDirChanged,
    });

    let result: string | undefined;
    function Harness(): React.ReactElement {
      result = useWorkingDirChip(ctx, '/project');
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(result).toBe('src');

    act(() => {
      for (const listener of listeners) {
        listener('/project');
      }
    });

    expect(result).toBeUndefined();
  });

  it('cleans up subscription on unmount', () => {
    const unsubscribe = vi.fn();
    const onWorkingDirChanged = vi.fn(() => unsubscribe);
    const ctx = makeContext({
      workingDir: '/project/src',
      onWorkingDirChanged,
    });

    function Harness(): React.ReactElement {
      useWorkingDirChip(ctx, '/project');
      return React.createElement(Text, null, 'test');
    }
    const view = render(React.createElement(Harness));
    expect(onWorkingDirChanged).toHaveBeenCalled();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('handles undefined workingDir from context', () => {
    let result: string | undefined = 'should-change';
    function Harness(): React.ReactElement {
      result = useWorkingDirChip(makeContext({ workingDir: undefined as never }), '/project');
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(result).toBeUndefined();
  });
});
