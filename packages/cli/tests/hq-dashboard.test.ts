// @vitest-environment jsdom

import { HQ_AUTH_FILE_VERSION, writeHqAuthFile } from '@wrongstack/core';
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type HqServerHandle, startHqServer } from '../src/hq-server.js';

/**
 * The HQ dashboard is a single self-contained document that loads React +
 * React Flow from a CDN (with a dependency-free offline fallback). It can't be
 * meaningfully executed in jsdom (top-level `await import()` from esm.sh, React
 * Flow), so these tests validate the *served document shell* and the data-plane
 * wiring referenced by its module script — the parts that must be correct for
 * the browser app to boot and reach the server.
 */

let handle: HqServerHandle | null = null;
let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-dash-'));
});

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

function getPort(): number {
  return 30_000 + Math.floor(Math.random() * 10_000);
}

async function startServer(): Promise<HqServerHandle> {
  await writeHqAuthFile(dataDir, {
    version: HQ_AUTH_FILE_VERSION,
    updatedAt: new Date().toISOString(),
    browserTokens: [],
    clientTokens: [],
  });
  return startHqServer({ port: getPort(), dataDir });
}

describe('HQ dashboard document', () => {
  it('serves a parseable document with the React mount point and CDN assets', async () => {
    handle = await startServer();
    const html = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    expect(doc.querySelector('title')?.textContent).toContain('WrongStack HQ');
    // React mount point + initial boot placeholder.
    expect(doc.getElementById('root')).not.toBeNull();
    expect(doc.getElementById('boot')).not.toBeNull();
    // React Flow stylesheet preloaded.
    const link = doc.querySelector('link[rel="stylesheet"]');
    expect(link?.getAttribute('href')).toContain('reactflow');
    // The app is an ES module so it can `import` React + React Flow.
    const mod = doc.querySelector('script[type="module"]');
    expect(mod).not.toBeNull();
  });

  it('wires the module script to the live fleet + transcript endpoints', async () => {
    handle = await startServer();
    const html = await (await fetch(`http://127.0.0.1:${handle.port}/`)).text();
    const dom = new JSDOM(html);
    const script = dom.window.document.querySelector('script[type="module"]')?.textContent ?? '';

    // Data plane: WS browser channel + REST seed + full-history fetch.
    expect(script).toContain('/ws/browser');
    expect(script).toContain('/api/fleet');
    expect(script).toContain('/api/sessions/');
    expect(script).toContain('?full=1');
    // Fleet tree builders + offline fallback.
    expect(script).toContain('buildTree');
    expect(script).toContain('buildGraph');
    expect(script).toContain('renderFallback');
    // Auto-layout (dagre) + draggable nodes + mode toolbar.
    expect(script).toContain('esm.sh/dagre');
    expect(script).toContain('layoutTree');
    expect(script).toContain('nodesDraggable: true');
    expect(script).toContain('Auto-arrange');
    // Live transcript streaming handler.
    expect(script).toContain('session.transcript');
  });

  it('preserves the browser token when wiring WS and fetch URLs', async () => {
    // Token mode on — the dashboard must thread ?token= through every call.
    await writeHqAuthFile(dataDir, {
      version: HQ_AUTH_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      browserTokens: [{ id: 'bt', token: 'tok-123', createdAt: new Date().toISOString() }],
      clientTokens: [],
    });
    handle = await startHqServer({ port: getPort(), dataDir });
    const html = await (await fetch(`http://127.0.0.1:${handle.port}/?token=tok-123`)).text();
    const dom = new JSDOM(html);
    const script = dom.window.document.querySelector('script[type="module"]')?.textContent ?? '';
    expect(script).toContain('withTok');
    expect(script).toContain("searchParams.get('token')");
  });
});
