/**
 * --hq short-circuit — extracted from cli-main.ts.
 *
 * Starts the HQ command center server before boot() — HQ is
 * project-independent. Blocks until SIGINT/SIGTERM.
 *
 * Returns 0 when the HQ flag was present and the server ran, or null
 * when the flag was absent (caller should proceed to boot()).
 */

/**
 * Check for --hq flag and start the HQ server if present.
 *
 * Returns 0 when the server started, or null when --hq was not set.
 */
export async function handleHqShortCircuit(
  flags: Record<string, string | boolean>,
): Promise<number | null> {
  if (flags['hq'] !== true) return null;

  const { startHqServer } = await import('../hq-server.js');
  const host = typeof flags['host'] === 'string' ? flags['host'] : '127.0.0.1';
  const port = typeof flags['port'] === 'string' ? Number.parseInt(flags['port'], 10) : 3499;
  const dataDir = typeof flags['data-dir'] === 'string' ? flags['data-dir'] : undefined;
  const handle = await startHqServer({
    host,
    port,
    strictPort: flags['strict-port'] === true,
    ...(dataDir !== undefined ? { dataDir } : {}),
  });
  if (flags['open'] === true) {
    try {
      const { openBrowser } = await import('@wrongstack/webui/server');
      openBrowser(handle.firstRunSetup?.browserUrl ?? `http://${handle.host}:${handle.port}`);
    } catch {
      // best-effort
    }
  }
  // Keep the process alive until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void handle.close().then(() => resolve());
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  return 0;
}
