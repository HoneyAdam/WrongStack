import { Component, type ReactNode } from 'react';
import { Box, Text } from '../ink.js';
import { theme } from '../theme.js';

interface Props {
  children: ReactNode;
  /** Short label for the fallback line, e.g. the entry id or kind. */
  label?: string | undefined;
}

interface State {
  error: Error | null;
}

/**
 * Isolates a render throw to a single history row.
 *
 * History entries render arbitrary model/tool output through markdown, table,
 * and diff renderers. Without a boundary, one malformed entry's throw unmounts
 * the ENTIRE Ink tree: the process-level crash shield keeps the process alive
 * but the UI goes permanently dead — and it recurs on resume because the entry
 * is persisted. Wrapping each entry degrades that to a single "⚠ render error"
 * line while the rest of the transcript keeps working.
 *
 * Note: React error boundaries catch throws during render/lifecycle of their
 * children only — not event handlers or async work. That is exactly the class
 * of failure this guards against.
 */
export class EntryErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      const label = this.props.label ? ` (${this.props.label})` : '';
      const message = error.message || String(error);
      return (
        <Box>
          <Text color={theme.error}>{`⚠ render error${label}: ${message}`}</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
