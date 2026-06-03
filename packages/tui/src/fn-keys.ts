/**
 * Function-key decoding for raw terminal input.
 *
 * Ink's `useInput` does not decode F1–F12, so the Input component catches the
 * raw escape sequences from stdin (the same mechanism it uses for Home/End)
 * and turns them into a `KeyEvent.fn` number. F-keys are terminal-safe aliases
 * for chords some terminals intercept before the app sees them — most notably
 * Windows Terminal, which binds Ctrl+F to "Find".
 *
 * Kept in its own pure, dependency-free module so it can be unit-tested without
 * importing the Ink/React component tree.
 */

/**
 * Map a raw terminal escape sequence to a plain function-key number (1–12),
 * or null when it isn't a plain F-key. Covers both the SS3 form (xterm F1–F4,
 * `ESC O P..S`) and the CSI `~` form used by F1–F12 across most terminals.
 * Modifier-augmented variants (Shift+F2 = `ESC [ 1 ; 2 Q`, etc.) are ignored.
 */
export function fnKey(data: string): number | null {
  switch (data) {
    case '\x1bOP':
    case '\x1b[11~':
      return 1;
    case '\x1bOQ':
    case '\x1b[12~':
      return 2;
    case '\x1bOR':
    case '\x1b[13~':
      return 3;
    case '\x1bOS':
    case '\x1b[14~':
      return 4;
    case '\x1b[15~':
      return 5;
    case '\x1b[17~':
      return 6;
    case '\x1b[18~':
      return 7;
    case '\x1b[19~':
      return 8;
    case '\x1b[20~':
      return 9;
    case '\x1b[21~':
      return 10;
    case '\x1b[23~':
      return 11;
    case '\x1b[24~':
      return 12;
    default:
      return null;
  }
}
