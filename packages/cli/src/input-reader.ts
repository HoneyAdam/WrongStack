import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InputReader, PromptOption } from '@wrongstack/core';

export interface ReadlineInputReaderOptions {
  historyFile?: string;
  prompt?: string;
}

export class ReadlineInputReader implements InputReader {
  private rl?: readline.Interface;
  private readonly historyFile: string;
  private history: string[] = [];
  private pending = false;

  constructor(opts: ReadlineInputReaderOptions = {}) {
    this.historyFile = opts.historyFile ?? path.join(os.homedir(), '.wrongstack', 'history');
  }

  private async loadHistory(): Promise<void> {
    try {
      const raw = await fs.readFile(this.historyFile, 'utf8');
      this.history = raw.split('\n').filter(Boolean).slice(-1000);
    } catch {
      this.history = [];
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.historyFile), { recursive: true });
      await fs.writeFile(this.historyFile, this.history.slice(-1000).join('\n'));
    } catch {
      // ignore
    }
  }

  private ensure(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        history: this.history,
        terminal: process.stdin.isTTY,
      });
    }
    return this.rl;
  }

  async readLine(prompt?: string): Promise<string> {
    if (this.history.length === 0) await this.loadHistory();
    while (this.pending) {
      // Wait for the current read to settle before accepting another.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    this.pending = true;
    try {
      const rl = this.ensure();
      if ((rl as unknown as { _flushed?: boolean })._flushed) {
        rl.close();
        this.rl = undefined;
      }
      const fresh = this.ensure();
      return new Promise<string>((resolve, reject) => {
        fresh.question(prompt ?? '> ', (line) => {
          if (line.trim()) {
            this.history.push(line);
            void this.saveHistory();
          }
          resolve(line);
        });
        fresh.once('close', () => reject(new Error('EOF')));
      });
    } finally {
      this.pending = false;
    }
  }

  async readKey(prompt: string, options: PromptOption[]): Promise<string> {
    process.stdout.write(prompt);
    return new Promise<string>((resolve) => {
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      const wasPaused = stdin.isPaused();
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const onData = (buf: Buffer) => {
        const key = buf.toString();
        const opt = options.find(
          (o) => o.key.toLowerCase() === key.toLowerCase() || o.value === key,
        );
        if (opt) {
          cleanup();
          process.stdout.write(`${opt.key}\n`);
          resolve(opt.value);
        }
      };
      const cleanup = () => {
        stdin.off('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        if (wasPaused) stdin.pause();
      };
      stdin.on('data', onData);
    });
  }

  /**
   * Read a single line of input without echoing it to the terminal. Used
   * for API keys / passwords. Non-TTY input is read normally — there's
   * nothing to hide when piped.
   */
  async readSecret(prompt: string): Promise<string> {
    const stdin = process.stdin;
    if (!stdin.isTTY) return this.readLine(prompt);
    // Tear down the active readline so we can take over stdin.
    this.rl?.close();
    this.rl = undefined;
    process.stdout.write(prompt);
    return new Promise<string>((resolve) => {
      let buf = '';
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n') {
            cleanup();
            process.stdout.write('\n');
            resolve(buf);
            return;
          }
          if (ch === '') {
            // Ctrl+C
            cleanup();
            process.stdout.write('\n');
            process.exit(130);
          }
          if (ch === '' || ch === '\b') {
            buf = buf.slice(0, -1);
            continue;
          }
          buf += ch;
        }
      };
      const cleanup = () => {
        stdin.off('data', onData);
        stdin.setRawMode(wasRaw);
        stdin.pause();
      };
      stdin.on('data', onData);
    });
  }

  async close(): Promise<void> {
    await this.saveHistory();
    this.rl?.close();
    this.rl = undefined;
  }
}
