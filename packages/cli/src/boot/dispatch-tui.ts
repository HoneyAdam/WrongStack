/** Thin production boundary around the optional, dynamically loaded TUI. */
import type { RunTuiOptions } from '@wrongstack/tui';

export async function runTuiDispatch(options: RunTuiOptions): Promise<number> {
  const { runTui } = await import('@wrongstack/tui');
  return runTui(options);
}
