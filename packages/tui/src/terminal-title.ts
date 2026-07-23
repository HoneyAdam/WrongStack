import type { EventBus } from '@wrongstack/core/kernel';

/**
 * Animated terminal/tab title for the TUI.
 *
 * Writes an OSC-0 sequence (`ESC ] 0 ; <text> BEL`) — an out-of-band terminal
 * command that sets the window/tab title without touching the screen, so it
 * never corrupts Ink's render. The title animates: a braille spinner plus a
 * live status derived from the agent's EventBus (thinking / running a tool),
 * and a static idle title. Reset to a static title on stop.
 *
 * Disable with WRONGSTACK_NO_TITLE=1.
 */

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const setTitle = (s: string): string => `\x1b]0;${s}\x07`;

export interface TerminalTitleOptions {
  stdout: NodeJS.WriteStream;
  events: EventBus;
  model?: string | undefined;
  appName?: string | undefined;
  intervalMs?: number | undefined;
  /** ms of silence before the title falls back to the idle marquee. */
  idleAfterMs?: number | undefined;
}

export function startTerminalTitle(opts: TerminalTitleOptions): () => void {
  const { stdout, events } = opts;
  if (process.env['WRONGSTACK_NO_TITLE'] === '1' || !stdout.isTTY) {
    return () => {};
  }

  const app = opts.appName ?? 'WrongStack';
  const idleAfter = opts.idleAfterMs ?? 3500;
  const suffix = ` · ${app}`;
  const idleTitle = opts.model ? `✦ ${app} · ${opts.model}` : `✦ ${app}`;

  let frame = 0;
  let phase: 'idle' | 'thinking' | 'tool' = 'idle';
  let toolName = '';
  let lastActivity = 0; // 0 → never active yet, start idle
  let lastWrittenTitle = '';

  const touch = (next: 'thinking' | 'tool', tool?: string) => {
    phase = next;
    if (tool) toolName = tool;
    lastActivity = Date.now();
  };

  const offs: Array<() => void> = [
    events.on('iteration.started', () => touch('thinking')),
    events.on('provider.text_delta', () => touch('thinking')),
    events.on('provider.thinking_delta', () => touch('thinking')),
    events.on('tool.started', (e) => touch('tool', (e as { name?: string | undefined }).name ?? 'tool')),
    events.on('tool.executed', () => touch('thinking')),
  ];

  const write = (s: string) => {
    try {
      stdout.write(s);
    } catch {
      /* stdout closed during shutdown */
    }
  };

  const timer = setInterval(() => {
    frame = (frame + 1) % SPINNER.length;
    if (lastActivity && Date.now() - lastActivity > idleAfter) phase = 'idle';

    const sp = SPINNER[frame];
    let title: string;
    if (phase === 'tool') {
      title = `${sp} ▸ ${toolName}${suffix}`;
    } else if (phase === 'thinking') {
      title = `${sp} thinking…${suffix}`;
    } else {
      title = idleTitle;
    }
    // Avoid emitting the exact same OSC sequence twice (terminal writes are
    // surprisingly costly on Windows hosts).
    if (title !== lastWrittenTitle) {
      lastWrittenTitle = title;
      write(setTitle(title));
    }
  }, opts.intervalMs ?? 1_000);
  // Don't keep the event loop alive just for the title animation.
  timer.unref?.();

  return () => {
    clearInterval(timer);
    for (const off of offs) off();
    write(setTitle(app));
  };
}
