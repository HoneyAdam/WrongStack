/**
 * HQ static-serve — resolve and serve the built `@wrongstack/webui-hq/dist`
 * dashboard. Mirrors the pattern in `webui-server/static-serve.ts` but for
 * the HQ app. Falls back to the inline `HQ_HTML` when the dist is unbuilt so
 * HQ is always functional.
 *
 * @module hq-static-serve
 */

import * as fs from 'node:fs';
import type * as http from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const requireFromHere = createRequire(import.meta.url);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

let cachedDistDir: string | null | undefined;

/**
 * Resolve the HQ dashboard dist directory. Returns the absolute path to
 * `@wrongstack/webui-hq/dist`, or `null` when the package/dist is not
 * present (e.g. unbuilt). Result is cached for the process lifetime.
 */
export function resolveHqDistDir(): string | null {
  if (cachedDistDir !== undefined) return cachedDistDir;

  // Strategy 1: resolve the package root via its package.json export. The
  // "." entry points at dist/index.js which the vite build does NOT emit
  // (the package is an asset carrier — dist holds index.html + assets/), so
  // resolving the bare specifier throws ERR_PACKAGE_PATH_NOT_EXPORTED /
  // MODULE_NOT_FOUND and, before this fix, HQ silently ALWAYS fell back to
  // the legacy inline HTML.
  try {
    const pkgJson = requireFromHere.resolve('@wrongstack/webui-hq/package.json');
    const dist = path.join(path.dirname(pkgJson), 'dist');
    if (fs.existsSync(path.join(dist, 'index.html'))) {
      cachedDistDir = dist;
      return dist;
    }
  } catch {
    /* fall through to strategy 2 */
  }

  // Strategy 2: walk up from this module looking for the workspace/installed
  // package under node_modules (also covers older installs whose package.json
  // exports map does not expose "./package.json").
  try {
    let dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'node_modules', '@wrongstack', 'webui-hq', 'dist');
      if (fs.existsSync(path.join(candidate, 'index.html'))) {
        cachedDistDir = candidate;
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* not found */
  }

  cachedDistDir = null;
  return null;
}

/** Check whether a resolved path stays inside the dist directory (no traversal). */
function isInsideDist(filePath: string, distDir: string): boolean {
  const rel = path.relative(distDir, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface ServeStaticResult {
  handled: boolean;
}

/**
 * Serve a static file from the HQ dist for an HTTP request. Handles the SPA
 * fallback (unknown routes → index.html). Returns `{handled:false}` when the
 * dist is not available (caller should serve the inline fallback) or the
 * path doesn't match a static asset.
 */
export function serveHqStatic(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  distDir: string,
): ServeStaticResult {
  // Normalize: `/` → index.html; otherwise decode + resolve.
  const relPath = urlPath === '/' || urlPath === '' ? '/index.html' : urlPath;
  const filePath = path.join(distDir, decodeURIComponent(relPath));

  if (!isInsideDist(filePath, distDir)) {
    return { handled: false };
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: serve index.html for client-side routes.
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.html']! });
      res.end(html);
      return { handled: true };
    }
    return { handled: false };
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(data);
  return { handled: true };
}
