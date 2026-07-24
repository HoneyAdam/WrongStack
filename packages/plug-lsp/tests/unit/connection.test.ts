import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Connection } from '../../src/server/connection.js';

describe('Connection transport resilience', () => {
  it('handles an stdin error without crashing and fails pending requests', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const conn = new Connection(stdin, stdout);

    const ctrl = new AbortController();
    const pending = conn.sendRequest('test/method', null, 5_000, ctrl.signal);

    // Server died: writing to its stdin breaks the pipe. Without an stdin
    // 'error' listener this would be an unhandled stream error and crash the
    // host; instead it must fail the pending request cleanly.
    stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));

    await expect(pending).rejects.toBeDefined();
  });
});
