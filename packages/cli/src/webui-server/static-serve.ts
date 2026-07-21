import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { type CreateHttpServerOptions, createHttpServer } from '@wrongstack/webui-server';

/**
 * PR 6 of Issue #30 (webui-server 8-PR refactor):
 * dist discovery + HTTP server bring-up.
 *
 * Before this PR, the `runWebUI` body inlined five lines
 * that resolved the webui package's `dist` directory via
 * `createRequire(import.meta.url)` and handed the path to
 * `createHttpServer`. If the webui package wasn't built,
 * the inline try/catch silently degraded to WS-only.
 *
 * After this PR, the dist-resolution lives in
 * `webui-server/static-serve.ts` and the only thing
 * `runWebUI` does is call `startStaticServe({ host,
 * httpPort, globalRoot })`. The function returns
 * the listening `Server` and its real `port` (the OS
 * may reassign if the requested port was in use), or
 * `null` when the webui package is unbuilt.
 *
 * The try/catch around the require resolution stays
 * inside this module so the runWebUI body does not have
 * to think about webui's build state at all.
 */

export interface StaticServeHandle {
  server: Server;
  port: number;
}

export interface StaticServeOptions {
  host: string;
  httpPort: number;
  globalRoot: string;
  /** Explicit frontend build. Omitted for the regular @wrongstack/webui app. */
  distDir?: string | undefined;
  /** Push-on-write hook for `POST /api/fleet/ping` (immediate fleet re-broadcast). */
  onFleetPing?: (() => void) | undefined;
  /** TechStack HTTP job events projected to the embedded WebSocket server. */
  onTechStackEvent?: ((event: import('@wrongstack/webui-server').WSServerMessage) => void) | undefined;
  /**
   * Live provider access for TechStack's LLM research stage. Omitting it
   * leaves `analyze` deterministic — so this must be threaded here as well as
   * in the standalone `start-webui` server, or the CLI-hosted WebUI silently
   * loses LLM analysis while the standalone one has it.
   */
  getLlm?:
    | (() => { provider: import('@wrongstack/core').Provider; model: string } | undefined)
    | undefined;
  /** Active target project root for TechStack and CodeMap APIs. */
  projectRoot?: string | undefined;
  /** Public browser-facing WS URL injected into the React app. */
  publicWsUrl?: string | undefined;
  /**
   * Shared auth token for `/ws-auth` and `/api/*` endpoints. Required for
   * the cookie-based auth flow: the frontend extracts this from the URL,
   * calls `/ws-auth?token=...` to get an HttpOnly cookie, then uses the
   * cookie for subsequent WS upgrades (closing C-598 query-string exposure).
   */
  apiToken?: string | undefined;
  /** Force token auth even when the server binds to loopback. */
  requireToken?: boolean | undefined;
}

/**
 * Resolve the webui package's built `dist` directory.
 *
 * Returns the absolute path, or `null` if the package's
 * server entry can't be resolved (webui not built). This
 * is the one piece of `startStaticServe` that touches the
 * module tree, so it lives behind its own function: tests
 * can exercise the resolution (and stub it) without
 * binding a socket.
 */
export function resolveDistDir(explicitDistDir?: string): string | null {
  if (explicitDistDir) return path.resolve(explicitDistDir);
  try {
    const requireFromHere = createRequire(import.meta.url);
    const serverEntry = requireFromHere.resolve('@wrongstack/webui');
    return path.dirname(serverEntry); // .../dist
  } catch {
    return null;
  }
}

/**
 * Resolve the WebUI dist, auto-building it when missing.
 *
 * Mirrors the SimpleUI cold-start recovery in `simpleui-dist.ts`:
 * after a fresh clone, `git clean`, or dependency update the `dist/`
 * directory (gitignored) may not exist. Instead of silently degrading
 * to WS-only, this function runs the Vite build automatically and
 * retries resolution. Falls back to `null` (WS-only) if the build
 * fails or the package cannot be resolved.
 */
export function ensureDistDir(explicitDistDir?: string): string | null {
  const resolved = resolveDistDir(explicitDistDir);
  if (resolved !== null) return resolved;
  if (explicitDistDir) return null; // explicit path given but missing — don't guess

  // Locate the workspace root to run the pnpm build command.
  const requireFromHere = createRequire(import.meta.url);
  let packageDir: string;
  try {
    packageDir = path.dirname(requireFromHere.resolve('@wrongstack/webui/package.json'));
  } catch {
    return null; // package not resolvable — can't auto-build
  }

  let workspaceRoot: string | null = null;
  let dir = packageDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      workspaceRoot = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!workspaceRoot) return null; // not in a pnpm workspace — can't auto-build

  console.warn(JSON.stringify({ level: 'warn', event: 'webui.auto_build', message: 'Frontend not built — building now', timestamp: new Date().toISOString() }));

  try {
    execSync('pnpm --filter @wrongstack/webui build', {
      cwd: workspaceRoot,
      stdio: 'inherit',
      timeout: 180_000,
    });
  } catch {
    return null; // build failed — degrade to WS-only
  }

  return resolveDistDir(explicitDistDir);
}

/**
 * Injectable seams for `startStaticServe`. Both default to
 * the real implementations; tests override them to assert
 * the wiring without resolving the webui package or binding
 * a real port.
 */
export interface StaticServeDeps {
  resolveDist?: (explicitDistDir?: string) => string | null;
  createServer?: (opts: CreateHttpServerOptions) => Server;
}

export function startStaticServe(
  opts: StaticServeOptions,
  deps: StaticServeDeps = {},
): StaticServeHandle | null {
  const resolveDist = deps.resolveDist ?? ensureDistDir;
  const create = deps.createServer ?? createHttpServer;

  const distDir = resolveDist(opts.distDir);
  if (distDir === null) return null;

  const server = create({
    host: opts.host,
    distDir,
    globalRoot: opts.globalRoot,
    onFleetPing: opts.onFleetPing,
    onTechStackEvent: opts.onTechStackEvent,
    getLlm: opts.getLlm,
    projectRoot: opts.projectRoot,
    publicWsUrl: opts.publicWsUrl,
    apiToken: opts.apiToken,
    requireToken: opts.requireToken,
  });

  server.listen(opts.httpPort, opts.host);
  // `createHttpServer` returns the bound port via
  // `server.address()` after `listen` resolves. We return
  // the requested port instead because the existing
  // call sites pass the requested port straight into
  // the open-browser URL — the runWebUI body has no
  // use for the bound-port value today. If a future
  // caller needs the actual bound port, this function
  // is the place to expose it (e.g. via a `listening`
  // event).
  return { server, port: opts.httpPort };
}
