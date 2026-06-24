import { HQ_AUTH_FILE_VERSION, writeHqAuthFile, writeHqRuntimeFile, type HqSocketLike } from '@wrongstack/core';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCliHqConnection } from '../src/hq-publisher.js';

let dataDir: string | undefined;
const oldDataDir = process.env['WRONGSTACK_HQ_DATA_DIR'];
const oldEnabled = process.env['WRONGSTACK_HQ_ENABLED'];
const oldUrl = process.env['WRONGSTACK_HQ_URL'];
const oldToken = process.env['WRONGSTACK_HQ_TOKEN'];

afterEach(async () => {
  if (oldDataDir === undefined) delete process.env['WRONGSTACK_HQ_DATA_DIR'];
  else process.env['WRONGSTACK_HQ_DATA_DIR'] = oldDataDir;
  if (oldEnabled === undefined) delete process.env['WRONGSTACK_HQ_ENABLED'];
  else process.env['WRONGSTACK_HQ_ENABLED'] = oldEnabled;
  if (oldUrl === undefined) delete process.env['WRONGSTACK_HQ_URL'];
  else process.env['WRONGSTACK_HQ_URL'] = oldUrl;
  if (oldToken === undefined) delete process.env['WRONGSTACK_HQ_TOKEN'];
  else process.env['WRONGSTACK_HQ_TOKEN'] = oldToken;

  if (dataDir !== undefined) {
    await fs.rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
  vi.useRealTimers();
});

class FakeSocket implements HqSocketLike {
  readyState = 1;
  sent: string[] = [];
  close = vi.fn();
  send(data: string): void {
    this.sent.push(data);
  }
  addEventListener(_type: 'open' | 'close' | 'error' | 'message', _listener: (event: unknown) => void): void {
    // Already open.
  }
  removeEventListener(_type: 'open' | 'close' | 'error' | 'message', _listener: (event: unknown) => void): void {
    // no-op
  }
}

describe('CLI HQ publisher connection', () => {
  it('connects later when the HQ runtime marker appears', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-hq-late-'));
    process.env['WRONGSTACK_HQ_DATA_DIR'] = dataDir;
    delete process.env['WRONGSTACK_HQ_ENABLED'];
    delete process.env['WRONGSTACK_HQ_URL'];
    delete process.env['WRONGSTACK_HQ_TOKEN'];

    let socket: FakeSocket | undefined;
    const onConnect = vi.fn();
    const conn = startCliHqConnection({
      clientKind: 'tui',
      projectRoot: dataDir,
      projectName: 'Late HQ',
      retryIntervalMs: 20,
      socketFactory: () => {
        socket = new FakeSocket();
        return socket;
      },
      onConnect,
    });

    expect(conn.getPublisher()).toBeUndefined();

    await writeHqAuthFile(dataDir, {
      version: HQ_AUTH_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      browserTokens: [],
      clientTokens: [],
    });
    await writeHqRuntimeFile(dataDir, { url: 'http://127.0.0.1:45678', pid: process.pid });

    await vi.waitFor(() => {
      expect(conn.getPublisher()).toBeDefined();
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(socket?.sent.some((frame) => frame.includes('client.hello'))).toBe(true);
    });

    conn.stop();
  });

  it('reconnects when a later runtime marker points at a different HQ port', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-hq-repoint-'));
    process.env['WRONGSTACK_HQ_DATA_DIR'] = dataDir;
    delete process.env['WRONGSTACK_HQ_ENABLED'];
    delete process.env['WRONGSTACK_HQ_URL'];
    delete process.env['WRONGSTACK_HQ_TOKEN'];

    await writeHqAuthFile(dataDir, {
      version: HQ_AUTH_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      browserTokens: [],
      clientTokens: [{ id: 'ct', token: 'client-token', createdAt: new Date().toISOString() }],
    });

    const urls: string[] = [];
    const onConnect = vi.fn();
    const conn = startCliHqConnection({
      clientKind: 'tui',
      projectRoot: dataDir,
      projectName: 'Repoint HQ',
      retryIntervalMs: 20,
      socketFactory: (url) => {
        urls.push(url);
        return new FakeSocket();
      },
      onConnect,
    });

    expect(conn.getPublisher()).toBeDefined();
    expect(urls[0]).toContain('127.0.0.1:3499');

    await writeHqRuntimeFile(dataDir, { url: 'http://127.0.0.1:45679', pid: process.pid });

    await vi.waitFor(() => {
      expect(onConnect).toHaveBeenCalledTimes(2);
      expect(urls.some((url) => url.includes('127.0.0.1:45679'))).toBe(true);
    });

    conn.stop();
  });
});
