/**
 * Detect whether this module was loaded as the CLI's main entry point
 * (vs imported as a library) and, if so, run the supplied `main` function
 * with the current process argv.
 *
 * Why a helper:
 *   1. **isMain detection in one place** — the `import.meta.url` /
 *      `process.argv[1]` comparison has both POSIX (`/`) and Windows (`\`)
 *      path forms; centralising it stops the pattern from drifting.
 *   2. **Bounded exit on both success and failure** — Node will normally
 *      drain async handles (undici TLS, log flushes) on its own, but a
 *      leaking plugin or MCP server can hang the process indefinitely.
 *      A 500ms `setTimeout(exit)` with `.unref()` lets the natural drain
 *      finish first, then forces exit if anything is still pending. The
 *      `.unref()` is critical: it prevents the timer itself from keeping
 *      the event loop alive.
 *   3. **Stack-trace on rejection** — a top-level `main().catch(...)` that
 *      logs `err.stack` (not just the message) makes crash dumps from
 *      end-user bug reports actually debuggable.
 */
import { writeErr } from '@wrongstack/core';

const isMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('/cli/dist/index.js') ||
  process.argv[1]?.endsWith('\\cli\\dist\\index.js');

interface ErrorEventStream {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  off(event: 'error', listener: (error: unknown) => void): unknown;
}

interface BrokenPipeHandlerOptions {
  streams?: readonly ErrorEventStream[] | undefined;
  exit?: ((code: number) => void) | undefined;
}

function isBrokenPipe(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPIPE';
}

/**
 * Treat a closed stdout/stderr consumer as a normal CLI shutdown.
 *
 * A failed `write()` is reported asynchronously through the destination
 * stream's `error` event, so wrapping individual writes in `try/catch` cannot
 * prevent Node's unhandled-event crash. Keep this guard at the process entry
 * boundary and rethrow every non-EPIPE error so genuine stream failures remain
 * visible.
 */
export function installBrokenPipeHandlers(
  options: BrokenPipeHandlerOptions = {},
): () => void {
  const streams = options.streams ?? [process.stdout, process.stderr];
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let handled = false;

  const onError = (error: unknown): void => {
    if (!isBrokenPipe(error)) throw error;
    if (handled) return;
    handled = true;
    exit(0);
  };

  for (const stream of streams) stream.on('error', onError);
  return () => {
    for (const stream of streams) stream.off('error', onError);
  };
}

export function runAsMain(mainFn: (argv: string[]) => Promise<number>): void {
  if (!isMain) return;
  installBrokenPipeHandlers();
  mainFn(process.argv.slice(2)).then(
    (c) => {
      // Set exitCode and let Node drain async handles (undici TLS, log file
      // flushes) naturally. Force-exit after a brief grace period so we don't
      // hang if a plugin or MCP server leaks. Avoids libuv UV_HANDLE_CLOSING
      // assertions seen on Windows when process.exit() races with handle teardown.
      process.exitCode = c;
      // 500ms grace: let undici TLS, log flushes, and plugin teardown complete.
      // The unref() prevents this timer from keeping the event loop alive
      // if everything else finishes first.
      setTimeout(() => process.exit(c), 500).unref();
    },
    (err) => {
      writeErr((err instanceof Error ? err.stack : String(err)) + '\n');
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 500).unref();
    },
  );
}
