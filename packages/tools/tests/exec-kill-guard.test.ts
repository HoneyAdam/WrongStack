import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { checkExecKillCommand } from '../src/exec-kill-guard.js';

describe.runIf(os.platform() === 'win32')('exec-kill-guard — Windows shell indirection', () => {
  it('blocks taskkill hidden behind cmd /c', async () => {
    const result = await checkExecKillCommand('cmd', ['/c', `taskkill /F /PID ${process.pid} /T`]);

    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/current WrongStack process|protected WrongStack process/i);
  });

  it('blocks taskkill /FI name-kill hidden behind cmd /c', async () => {
    // /FI "IMAGENAME eq node.exe" is functionally equivalent to /IM
    const result = await checkExecKillCommand('cmd', [
      '/c',
      `taskkill /F /FI "IMAGENAME eq node.exe" /T`,
    ]);

    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/WrongStack|node/);
  });

  it('blocks Stop-Process hidden behind PowerShell -Command', async () => {
    const result = await checkExecKillCommand('pwsh', [
      '-Command',
      `Stop-Process -Id ${process.pid} -Force`,
    ]);

    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/current WrongStack process|protected WrongStack process/i);
  });
});
