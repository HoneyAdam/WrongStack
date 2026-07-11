import { fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../src/stores/file-store';
import { useFileStore } from '../../src/stores/file-store';
import { useSessionStore } from '../../src/stores';

// The tree is virtualized with virtua; jsdom has no layout, so windowing
// would render an unpredictable subset. Mock VList as a passthrough — these
// tests cover the flatten/expand/keyboard logic, not virtua's windowing.
vi.mock('virtua', () => ({
  VList: forwardRef(function MockVList(
    { children, ...rest }: { children: React.ReactNode; className?: string },
    ref: React.Ref<{ scrollToIndex: (i: number, opts?: unknown) => void }>,
  ) {
    useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }));
    return <div {...rest}>{children}</div>;
  }),
}));

import { FileExplorer } from '../../src/components/FileExplorer';

const makeTree = (): TreeNode[] => [
  {
    name: 'src',
    path: '/proj/src',
    type: 'directory',
    children: [
      { name: 'app.ts', path: '/proj/src/app.ts', type: 'file' },
      {
        name: 'lib',
        path: '/proj/src/lib',
        type: 'directory',
        children: [{ name: 'util.ts', path: '/proj/src/lib/util.ts', type: 'file' }],
      },
    ],
  },
  { name: 'empty-dir', path: '/proj/empty-dir', type: 'directory', children: [] },
  { name: 'readme.md', path: '/proj/readme.md', type: 'file' },
];

beforeEach(() => {
  useFileStore.getState().setTree('/proj', makeTree());
  useSessionStore.setState({ cwd: '/proj', projectName: 'proj' });
});

describe('FileExplorer (virtualized tree)', () => {
  it('auto-expands root-level directories only', () => {
    render(<FileExplorer />);
    // Root dir children are visible…
    expect(screen.getByText('app.ts')).toBeTruthy();
    expect(screen.getByText('lib')).toBeTruthy();
    expect(screen.getByText('readme.md')).toBeTruthy();
    // …but nested (depth-2) content stays collapsed.
    expect(screen.queryByText('util.ts')).toBeNull();
  });

  it('expands and collapses a directory on click', () => {
    render(<FileExplorer />);
    fireEvent.click(screen.getByText('lib'));
    expect(screen.getByText('util.ts')).toBeTruthy();
    fireEvent.click(screen.getByText('lib'));
    expect(screen.queryByText('util.ts')).toBeNull();
  });

  it('shows the empty placeholder under an expanded empty directory', () => {
    render(<FileExplorer />);
    // Root dirs auto-expand, so the placeholder is visible immediately…
    expect(screen.getByText('empty')).toBeTruthy();
    // …and collapsing the dir removes it.
    fireEvent.click(screen.getByText('empty-dir'));
    expect(screen.queryByText('empty')).toBeNull();
  });

  it('expand-all reveals nested files; collapse-all hides everything', () => {
    render(<FileExplorer />);
    fireEvent.click(screen.getByText('Expand all'));
    expect(screen.getByText('util.ts')).toBeTruthy();
    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.queryByText('util.ts')).toBeNull();
    expect(screen.queryByText('app.ts')).toBeNull();
    // Root rows stay visible.
    expect(screen.getByText('src')).toBeTruthy();
  });

  it('supports arrow-key navigation: focus, expand, collapse', () => {
    render(<FileExplorer />);
    const tree = screen.getByRole('tree');

    // Tab into the tree highlights the first row (src).
    fireEvent.focus(tree);
    // ArrowDown twice: src → app.ts → lib.
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    // ArrowRight on the collapsed `lib` dir expands it.
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(screen.getByText('util.ts')).toBeTruthy();
    // ArrowLeft collapses it again.
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.queryByText('util.ts')).toBeNull();
  });

  it('Enter on a file dispatches the open-file event', () => {
    const seen: string[] = [];
    const onOpen = (e: Event) => {
      seen.push((e as CustomEvent<{ filePath: string }>).detail.filePath);
    };
    window.addEventListener('wrongstack:open-file', onOpen);
    try {
      render(<FileExplorer />);
      const tree = screen.getByRole('tree');
      fireEvent.focus(tree); // focus row 0 (src)
      fireEvent.keyDown(tree, { key: 'ArrowDown' }); // app.ts
      fireEvent.keyDown(tree, { key: 'Enter' });
      expect(seen).toEqual(['/proj/src/app.ts']);
    } finally {
      window.removeEventListener('wrongstack:open-file', onOpen);
    }
  });

  it('keeps user expansion when the tree refreshes for the same cwd', () => {
    render(<FileExplorer />);
    fireEvent.click(screen.getByText('lib'));
    expect(screen.getByText('util.ts')).toBeTruthy();
    // Watcher-style refresh: same cwd, new tree objects.
    useFileStore.getState().setTree('/proj', makeTree());
    expect(screen.getByText('util.ts')).toBeTruthy();
  });
});
