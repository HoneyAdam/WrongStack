import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import { bashTool } from '../src/bash.js';
import { mkSandbox, newSignal } from './fixtures.js';

const isWin = os.platform() === 'win32';
const echoCmd = isWin ? 'echo hello' : 'echo hello';
const failCmd = isWin ? 'exit 7' : 'exit 7';

describe('bashTool', () => {
  it('runs a simple command and captures output', async () => {
    const sb = await mkSandbox();
    try {
      const out = await bashTool.execute(
        { command: echoCmd },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.exit_code).toBe(0);
      expect(out.output.trim()).toContain('hello');
      expect(out.timed_out).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it('reports non-zero exit code', async () => {
    const sb = await mkSandbox();
    try {
      const out = await bashTool.execute(
        { command: failCmd },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.exit_code).toBe(7);
    } finally {
      await sb.cleanup();
    }
  });

  it('rejects on missing command', async () => {
    const sb = await mkSandbox();
    try {
      await expect(
        bashTool.execute({ command: '' }, sb.ctx, { signal: newSignal() }),
      ).rejects.toThrow();
    } finally {
      await sb.cleanup();
    }
  });

  it('honours timeout for long-running command', async () => {
    const sb = await mkSandbox();
    try {
      const cmd = isWin ? 'ping -n 5 127.0.0.1 > NUL' : 'sleep 5';
      const out = await bashTool.execute(
        { command: cmd, timeout_ms: 200 },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.timed_out).toBe(true);
    } finally {
      await sb.cleanup();
    }
  }, 15_000);
});
