import { spawn } from 'node:child_process';

/**
 * Minimal shape shared by Node's `ChildProcess` and the transport's
 * `ACPChildProcess`. `ChildProcess.kill` returns boolean; the no-arg
 * `ACPChildProcess.kill(): void` is assignable to this wider signature.
 */
interface KillableChild {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean | void;
}

/**
 * Kill a spawned ACP agent and its descendants.
 *
 * On Windows an external agent is launched through a `cmd.exe /c` shim
 * (buildWin32CmdShimInvocation), so the tracked child is the cmd.exe wrapper
 * and the real agent (npx→node, python, …) is its grandchild. A bare
 * `child.kill()` signals only the wrapper and orphans the agent process, which
 * then accumulates across sessions/restarts. `taskkill /T` tears down the whole
 * tree; if spawning taskkill fails we fall back to the direct kill. POSIX gets
 * SIGTERM with a SIGKILL backstop.
 */
export function treeKill(child: KillableChild): void {
  if (child.pid === undefined) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    return;
  }
  if (process.platform === 'win32') {
    try {
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
    } catch {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
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
