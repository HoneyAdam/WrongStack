/**
 * Port constants for the WebUI / SimpleUI servers.
 *
 * Design:
 * - **Single port — shared HTTP + WebSocket.** The WebSocket server attaches
 *   to the HTTP server (`new WebSocketServer({ server: httpServer })`), so
 *   both protocols share one port. No separate WS port is needed.
 * - **Auto-advance.** When a port is taken the server probes upward — WebUI
 *   starts at 3456, SimpleUI at 3466. Set `WEBUI_STRICT_PORT=1` to disable.
 * - **TOCTOU window.** The probe in `findFreePort` binds a throwaway
 *   `net.Server` then closes it, so there is a tiny race between "found free"
 *   and "real server binds". For local multi-instance use that race is
 *   negligible; if it ever loses, the real bind fails loudly with EADDRINUSE
 *   exactly as before.
 * - **Instance registry.** Every live process records itself in
 *   `~/.wrongstack/webui-instances.json` with its PID, surface, port, and
 *   project root. A crashed instance is pruned on the next registry read
 *   (`process.kill(pid, 0)` probe), so ghosts don't accumulate.
 */

import * as net from 'node:net';
import { ToolValidationError } from '@wrongstack/core/types';

/**
 * Surface-specific default single port.
 *
 * WebSocket shares the HTTP port (single-port design), so only one port
 * number is specified per surface:
 *
 *   WebUI:   3456
 *   SimpleUI: 3466
 */
export const SURFACE_DEFAULT_PORTS = {
  webui:   { http: 3456 },
  simpleui: { http: 3466 },
} as const satisfies Record<string, { http: number }>;

export type SurfaceKind = keyof typeof SURFACE_DEFAULT_PORTS;

/** Human-readable label for surfaces. */
export function surfaceLabel(surface: SurfaceKind): string {
  return surface === 'webui' ? 'WebUI' : 'SimpleUI';
}

/**
 * Return the surface-specific default HTTP port.
 */
export function getSurfaceDefaultPorts(surface: SurfaceKind): {
  http: number;
} {
  return { http: SURFACE_DEFAULT_PORTS[surface].http };
}

/** Resolve true when `port` can be bound on `host`, false on EADDRINUSE/EACCES. */
export function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    try {
      srv.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

export interface FindFreePortOptions {
  /** Ports to skip even if free (e.g. one already chosen for the sibling server). */
  exclude?: Set<number> | undefined;
  /** How many consecutive ports to try before giving up. Default 200. */
  maxTries?: number | undefined;
}

/**
 * Find the first free port at or above `startPort` on `host`, skipping any in
 * `exclude`. Throws if nothing is free within `maxTries` steps.
 */
export async function findFreePort(
  host: string,
  startPort: number,
  opts: FindFreePortOptions = {},
): Promise<number> {
  const exclude = opts.exclude ?? new Set<number>();
  const maxTries = opts.maxTries ?? 200;
  let port = startPort;
  for (let i = 0; i < maxTries; i++) {
    // Stay inside the valid TCP range; wrap into the high ephemeral band if a
    // pathological startPort pushes us past the ceiling.
    if (port > 65535) port = 1024 + (port % 50000);
    if (!exclude.has(port) && (await isPortFree(host, port))) {
      return port;
    }
    port++;
  }
  throw new ToolValidationError({
    message: `No free port found near ${startPort} on ${host} after ${maxTries} attempts.`,
    field: 'port',
  });
}
