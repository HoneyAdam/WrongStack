import { type ChildProcess, spawn } from 'node:child_process';

/**
 * Kill a language server and its descendants. On Windows, npm-based servers are
 * launched through a `.cmd` shim with `shell: true`, so `this.child` is the
 * `cmd.exe` wrapper and the real `node.exe` server is its grandchild — a plain
 * `child.kill()` signals only the wrapper and orphans the server, which then
 * accumulates across sessions/restarts. `taskkill /T` tears down the whole
 * tree. POSIX gets SIGTERM with a SIGKILL backstop.
 */
export function treeKill(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    });
    killer.unref();
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, 2000).unref();
}
