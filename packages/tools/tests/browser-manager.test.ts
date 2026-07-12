import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserSessionManager } from '../src/browser/manager.js';

let tmp: string;
let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-browser-'));
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html><head><title>Fixture App</title></head><body>
        <label>Name <input id="name" /></label>
        <select id="role"><option value="dev">Developer</option><option value="qa">QA</option></select>
        <button id="submit" onclick="document.querySelector('#status').textContent = document.querySelector('#name').value + ':' + document.querySelector('#role').value">Submit</button>
        <div id="status">idle</div>
        <script>console.log('token=fixture-secret')</script>
      </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}/`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('BrowserSessionManager Playwright fixture integration', () => {
  it('navigates, observes, interacts, captures evidence, and reclaims the browser', async () => {
    const manager = new BrowserSessionManager({
      artifactRoot: path.join(tmp, 'artifacts'),
      allowPrivateHosts: true,
      operationTimeoutMs: 10_000,
    });
    const signal = new AbortController().signal;
    try {
      const opened = await manager.open('leader', { url: baseUrl, trace: true }, signal);
      expect(opened.url).toBe(baseUrl);
      expect(opened.title).toBe('Fixture App');

      await manager.type(opened.id, 'leader', '#name', 'Ada', signal);
      await manager.select(opened.id, 'leader', '#role', 'qa', signal);
      await manager.hover(opened.id, 'leader', '#submit', signal);
      await manager.click(opened.id, 'leader', '#submit', signal);
      await manager.wait(opened.id, 'leader', { selector: '#status' }, signal);

      const snapshot = await manager.snapshot(opened.id, 'leader', signal);
      expect(snapshot.aria).toContain('Ada:qa');
      expect(snapshot.console).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('[REDACTED]') }),
        ]),
      );
      expect(JSON.stringify(snapshot.console)).not.toContain('fixture-secret');
      expect(snapshot.network[0]?.url).toBe(baseUrl);

      const shot = await manager.screenshot(opened.id, 'leader', { fullPage: true }, signal);
      expect(shot.kind).toBe('screenshot');
      expect(shot.path.startsWith(path.join(tmp, 'artifacts'))).toBe(true);
      expect((await fs.stat(shot.path)).size).toBeGreaterThan(0);

      const closed = await manager.close(opened.id, 'leader');
      expect(closed.trace?.kind).toBe('trace');
      expect((await fs.stat(closed.trace!.path)).size).toBeGreaterThan(0);
      expect(await manager.list('leader')).toEqual([]);
    } finally {
      await manager.dispose();
    }
  }, 30_000);

  it('isolates sessions by agent owner', async () => {
    const manager = new BrowserSessionManager({
      artifactRoot: path.join(tmp, 'artifacts'),
      allowPrivateHosts: true,
    });
    const signal = new AbortController().signal;
    try {
      const opened = await manager.open('agent-a', { url: baseUrl, trace: false }, signal);
      expect(await manager.list('agent-a')).toHaveLength(1);
      expect(await manager.list('agent-b')).toHaveLength(0);
      await expect(manager.snapshot(opened.id, 'agent-b', signal)).rejects.toThrow(/another agent/);
      await manager.closeOwner('agent-a');
      expect(await manager.list('agent-a')).toHaveLength(0);
    } finally {
      await manager.dispose();
    }
  }, 30_000);

  it('closes the session context when an operation is aborted', async () => {
    const manager = new BrowserSessionManager({
      artifactRoot: path.join(tmp, 'artifacts'),
      allowPrivateHosts: true,
    });
    const opened = await manager.open(
      'leader',
      { url: baseUrl, trace: false },
      new AbortController().signal,
    );
    const controller = new AbortController();
    const waiting = manager.wait(opened.id, 'leader', { timeoutMs: 10_000 }, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
    expect(await manager.list('leader')).toEqual([]);
    await manager.dispose();
  }, 30_000);
});
