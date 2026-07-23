import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesView } from '../../src/components/ChangesView.js';
import { useGitChangesStore } from '../../src/stores/git-changes-store.js';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="monaco-diff-editor" />,
  loader: { config: vi.fn() },
}));

vi.mock('monaco-editor', () => ({
  editor: {
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
  },
}));

describe('ChangesView edit mode', () => {
  beforeEach(() => {
    useGitChangesStore.setState({
      selectedPath: 'src/example.ts',
      diff: {
        path: 'src/example.ts',
        oldText: 'const value = 1;\n',
        newText: 'const value = 2;\n',
      },
      loadingDiff: false,
    });
  });

  afterEach(() => {
    cleanup();
    useGitChangesStore.getState().clear();
  });

  it('shows a full-height Monaco editor when Edit is selected', () => {
    render(<ChangesView className="h-full" />);

    fireEvent.click(screen.getByTitle('Side-by-side editable diff'));

    const editor = screen.getByTestId('monaco-diff-editor');
    const editSurface = editor.closest('.h-full');

    expect(editSurface).not.toBeNull();
    expect(editSurface?.parentElement?.className).toContain('flex');
  });
});
