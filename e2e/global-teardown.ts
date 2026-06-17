import type { FullConfig } from '@playwright/test';

/** Kill the WebUI server started by global-setup. */
export default async function globalTeardown(
  config: FullConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<void> {
  const server = (config as any)._serverProcess as
    | ReturnType<typeof import('node:child_process').spawn>
    | undefined;
  if (server && !server.killed) {
    server.once('exit', () => undefined); // ignore already-exited
    server.kill('SIGTERM');
    await new Promise<void>((r) => server.once('exit', () => r()));
  }
}
