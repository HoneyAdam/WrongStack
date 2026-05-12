import { color } from '@wrongstack/core';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Minimal single-line spinner. Writes to stderr so it doesn't get mixed with
 * the agent's stdout output (assistant text, tool diffs). Auto-no-ops outside
 * a TTY so logs don't get spammed with control codes.
 */
export class Spinner {
  private timer?: NodeJS.Timeout;
  private frame = 0;
  private active = false;
  private label = '';
  private startedAt = 0;
  private readonly out: NodeJS.WriteStream;
  private readonly enabled: boolean;

  constructor(out: NodeJS.WriteStream = process.stderr) {
    this.out = out;
    this.enabled = Boolean(out.isTTY) && !process.env.NO_COLOR;
  }

  start(label: string): void {
    if (!this.enabled || this.active) return;
    this.label = label;
    this.frame = 0;
    this.active = true;
    this.startedAt = Date.now();
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, 80);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clearLine();
  }

  /** Stop and persist a one-line note where the spinner was (e.g. "✓ done in 1.4s"). */
  stopWith(note: string): void {
    this.stop();
    this.out.write(`${note}\n`);
  }

  private render(): void {
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const line = `${color.amber(FRAMES[this.frame] ?? '')} ${this.label} ${color.dim(`${elapsed}s`)}`;
    this.clearLine();
    this.out.write(line);
  }

  private clearLine(): void {
    if (!this.enabled) return;
    this.out.write('\r\x1b[2K');
  }
}
