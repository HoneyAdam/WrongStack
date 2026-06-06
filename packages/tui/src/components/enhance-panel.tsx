import { Box, Text, useInput } from 'ink';
import React from 'react';

export type EnhanceDecision = 'refined' | 'original' | 'edit';

export interface EnhancePanelProps {
  /** The user's original message. */
  original: string;
  /** The refiner's rewritten version. */
  refined: string;
  /** Auto-send countdown in milliseconds. */
  delayMs: number;
  /** Called once with the chosen action (by key press or countdown expiry). */
  onDecision: (decision: EnhanceDecision) => void;
}

/**
 * Prompt-refinement preview ("did you mean this?"). Shows the refined request
 * with a live countdown; auto-sends the refined version when the countdown
 * expires unless the user intervenes:
 *   Enter → send refined now · Esc → use original · e → edit refined
 *
 * Self-contained like ConfirmPrompt: owns its keys via `useInput` and its
 * timer via `useEffect`. `onDecision` is guarded by the caller so only the
 * first decision wins.
 */
export function EnhancePanel({
  original,
  refined,
  delayMs,
  onDecision,
}: EnhancePanelProps): React.ReactElement {
  const totalSecs = Math.max(1, Math.ceil(delayMs / 1000));
  const [remaining, setRemaining] = React.useState(totalSecs);

  // Tick the countdown once per second; fire 'refined' when it reaches 0.
  // The latest onDecision is read from a ref so the interval never goes stale.
  const decideRef = React.useRef(onDecision);
  decideRef.current = onDecision;
  React.useEffect(() => {
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          decideRef.current('refined');
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useInput((input, key) => {
    if (key.return) {
      onDecision('refined');
    } else if (key.escape) {
      onDecision('original');
    } else if (input?.toLowerCase() === 'e') {
      onDecision('edit');
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box flexDirection="row">
        <Text bold color="cyan">
          ✨ Refined request
        </Text>
        <Text> </Text>
        <Text dimColor>— sending in {remaining}s</Text>
      </Box>
      <Box flexDirection="row">
        <Text dimColor>original: </Text>
        <Text dimColor>{original}</Text>
      </Box>
      <Box flexDirection="row">
        <Text color="green">refined:  </Text>
        <Text color="white">{refined}</Text>
      </Box>
      <Text dimColor>─────────────────</Text>
      <Box flexDirection="row">
        <Text>
          <Text bold color="green">
            [Enter]
          </Text>
          <Text dimColor> send · </Text>
          <Text bold color="yellow">
            [Esc]
          </Text>
          <Text dimColor> use original · </Text>
          <Text bold color="cyan">
            [e]
          </Text>
          <Text dimColor>dit</Text>
        </Text>
      </Box>
    </Box>
  );
}
