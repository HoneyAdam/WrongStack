// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3466/chat" }

import { afterEach, describe, expect, it } from 'vitest';
import { defaultWsUrl } from '../src/lib/ws.js';

afterEach(() => {
  document.head.querySelector('meta[name="wrongstack-ws-url"]')?.remove();
});

describe('SimpleUI WebSocket URL', () => {
  it('uses the exact HTTP page host and port for the same-origin socket', () => {
    expect(defaultWsUrl().toString()).toBe('ws://localhost:3466/');
  });

  it('uses an explicitly configured public WebSocket URL', () => {
    const meta = document.createElement('meta');
    meta.name = 'wrongstack-ws-url';
    meta.content = 'wss://public.example.test/socket';
    document.head.append(meta);

    expect(defaultWsUrl().toString()).toBe('wss://public.example.test/socket');
  });
});
