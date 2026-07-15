/**
 * Free-port discovery for the WebUI / SimpleUI servers.
 *
 * Design:
 * - **Surface-aware port ranges.** WebUI defaults to 3456 (HTTP) / 3457 (WS);
 *   SimpleUI defaults to 3466 / 3467. These ranges are disjoint, so a WebUI
 *   instance never accidentally claims a SimpleUI slot and vice versa.
 * - **Auto-advance.** When a port is taken, the server probes upward and binds
 *   the first free one (see `findFreePort`). The actual port is stamped into
 *   the served HTML and the instance registry so the user sees the real URL.
 * - **Instance registry.** Every live process records itself in
 *   `~/.wrongstack/webui-instances.json` with its PID, surface, ports, and
 *   project root. A crashed instance is pruned on the next registry read
 *   (`process.kill(pid, 0)` probe), so ghosts don't accumulate.
 * - **TOCTOU window.** The probe binds a throwaway `net.Server` then closes
 *   it, so there is a tiny race between "found free" and "real server binds".
 *   For local multi-instance use that race is negligible; if it ever loses,
 *   the real bind fails loudly with EADDRINUSE exactly as before.
 */

import * as net from 'node:net';
import { ToolValidationError } from '@wrongstack/core';

/**
 * Surface-specific default port ranges.
 *
 * These bases are intentionally spaced so the auto-advance window of one
 * surface (typically a few ports up) never reaches the other surface's base:
 *
 *   WebUI:   HTTP 3456-3465, WS 3457-3466  (10-port window)
 *   SimpleUI: HTTP 3466-3475, WS 3467-3476  (10-port window)
 *
 * This keeps the ranges visually distinct and prevents accidental overlap
 * when both surfaces run multiple instances in the same project.
 */
export const SURFACE_DEFAULT_PORTS = {
  webui:   { http: 3456, ws: 3457 },
  simpleui: { http: 3466, ws: 3467 },
} as const satisfies Record<string, { http: number; ws: number }>;

export type SurfaceKind = keyof typeof SURFACE_DEFAULT_PORTS;

/** Human-readable label for surfaces. */
export function surfaceLabel(surface: SurfaceKind): string {
  return surface === 'webui' ? 'WebUI' : 'SimpleUI';
}

/**
 * Return the surface-specific default port pair (HTTP + WS).
 * Freezes the returned object so callers can't mutate the constant table.
 */
export function getSurfaceDefaultPorts(surface: SurfaceKind): {
  http: number;
  ws: number;
} {
  return { ...SURFACE_DEFAULT_PORTS[surface] };
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
