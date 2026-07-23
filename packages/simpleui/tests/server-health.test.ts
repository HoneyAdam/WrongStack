// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3466/chat" }

import { describe, expect, it } from 'vitest';
import { classifyOutage, probeServer } from '../src/lib/server-health.js';

describe('SimpleUI server-outage probe', () => {
  it('treats any HTTP response as reachable, even an error status', async () => {
    const okFetch = (async () => new Response('ok', { status: 200 })) as typeof fetch;
    const errorFetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
    expect(await probeServer(okFetch)).toBe('reachable');
    expect(await probeServer(errorFetch)).toBe('reachable');
  });

  it('treats a network-level failure as unreachable', async () => {
    const deadFetch = (async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.');
    }) as typeof fetch;
    expect(await probeServer(deadFetch)).toBe('unreachable');
  });

  it('classifies a dead port as server-gone and a live one as ws-blocked', () => {
    expect(classifyOutage('unreachable')).toBe('server-gone');
    expect(classifyOutage('reachable')).toBe('ws-blocked');
  });
});
