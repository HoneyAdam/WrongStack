import { Box, Text, useInput, useStdin } from 'ink';
import type React from 'react';
import { useEffect } from 'react';
import { splitChips } from '../input-tokens.js';

export interface InputProps {
  prompt?: string;
  value: string;
  cursor: number;
  disabled?: boolean;
  hint?: string;
  onKey: (input: string, key: KeyEvent) => void;
}

/**
 * Render a buffer fragment as coloured chip spans + plain text. Chips are
 * dim-cyan so they read as a single styled block; plain runs render verbatim.
 * The `keyPrefix` keeps React keys unique across the before/after halves.
 */
function renderChips(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let offset = 0; // running char offset — a stable, unique key per span
  for (const span of splitChips(text)) {
    const key = `${keyPrefix}-${offset}`;
    out.push(
      span.chip ? (
        <Text key={key} color="cyan" dimColor>
          {span.text}
        </Text>
      ) : (
        <Text key={key}>{span.text}</Text>
      ),
    );
    offset += span.text.length;
  }
  return out;
}

export interface KeyEvent {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
}

// Ink 5.x useInput does not expose home/end as boolean flags even though
// parseKeypress recognizes them. We subscribe to raw stdin to catch these.
function isHomeEnd(data: string): 'home' | 'end' | null {
  // Common terminal sequences for Home/End.
  // CSI H / CSI F are the most universal; the longer variants are fallbacks.
  if (
    data === '\x1b[H' ||
    data === '\x1b[1~' ||
    data === '\x1bOH' ||
    data === '\x1b[7~'
  )
    return 'home';
  if (
    data === '\x1b[F' ||
    data === '\x1b[4~' ||
    data === '\x1bOF' ||
    data === '\x1b[8~'
  )
    return 'end';
  return null;
}

const EMPTY_KEY: KeyEvent = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  return: false,
  escape: false,
  ctrl: false,
  meta: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
};

export function Input({
  prompt = '› ',
  value,
  cursor,
  disabled,
  hint,
  onKey,
}: InputProps): React.ReactElement {
  useInput((input, key) => {
    if (disabled) return;
    onKey(input, key as KeyEvent);
  });

  // Catch Home/End that Ink's useInput doesn't surface.
  const { stdin } = useStdin();
  useEffect(() => {
    if (!stdin || disabled) return;
    const handleData = (data: Buffer) => {
      const kind = isHomeEnd(data.toString());
      if (kind === 'home') onKey('', { ...EMPTY_KEY, home: true });
      else if (kind === 'end') onKey('', { ...EMPTY_KEY, end: true });
    };
    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [stdin, disabled, onKey]);

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || ' ';
  const after = value.slice(cursor + 1);

  // Disabled (aborting an iteration) is the only signal that needs a
  // hard visual cue — paint the prompt red. We avoid wrapping the input
  // in a border Box: Ink redraws the live area on every state change,
  // and in non-altScreen mode the previous frame's border is left in
  // the terminal's scrollback. A `> ` prompt + inverse cursor is enough
  // to indicate the input row.
  const promptColor = disabled ? 'red' : 'cyan';

  return (
    <Box flexDirection="column">
      {/* Single <Text> wrapper so prompt + buffer + cursor + tail all wrap
          as one continuous string. Splitting them across sibling Text
          elements would let each piece wrap independently and shift the
          cursor cell off the intended character. Attachment chips are nested
          inline <Text> spans, so they colour without breaking the flow. */}
      <Text>
        <Text color={promptColor}>{prompt}</Text>
        {renderChips(before, 'b')}
        <Text inverse>{at}</Text>
        {renderChips(after, 'a')}
      </Text>
      {hint ? <Text dimColor>{hint}</Text> : null}
    </Box>
  );
}
