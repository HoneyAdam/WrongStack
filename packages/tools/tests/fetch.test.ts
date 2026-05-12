import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchTool } from '../src/fetch.js';
import { mkSandbox, newSignal } from './fixtures.js';

function mkResponse(opts: {
  body: string;
  status?: number;
  url?: string;
  contentType?: string;
}): Response {
  const enc = new TextEncoder();
  const bytes = enc.encode(opts.body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    status: opts.status ?? 200,
    ok: (opts.status ?? 200) < 400,
    url: opts.url ?? 'https://example.com/',
    headers: new Headers({ 'content-type': opts.contentType ?? 'text/plain' }),
    body: stream,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchTool', () => {
  it('rejects non-http(s) protocols', async () => {
    const sb = await mkSandbox();
    try {
      await expect(
        fetchTool.execute({ url: 'file:///etc/passwd' }, sb.ctx, { signal: newSignal() }),
      ).rejects.toThrow(/unsupported protocol/);
    } finally {
      await sb.cleanup();
    }
  });

  it('blocks http:// by default', async () => {
    const sb = await mkSandbox();
    try {
      await expect(
        fetchTool.execute({ url: 'http://example.com' }, sb.ctx, { signal: newSignal() }),
      ).rejects.toThrow(/http.* blocked/);
    } finally {
      await sb.cleanup();
    }
  });

  it('blocks localhost', async () => {
    const sb = await mkSandbox();
    try {
      await expect(
        fetchTool.execute({ url: 'https://localhost/foo' }, sb.ctx, { signal: newSignal() }),
      ).rejects.toThrow(/localhost/);
    } finally {
      await sb.cleanup();
    }
  });

  it('blocks private IPv4 ranges', async () => {
    const sb = await mkSandbox();
    try {
      await expect(
        fetchTool.execute({ url: 'https://10.0.0.1/' }, sb.ctx, { signal: newSignal() }),
      ).rejects.toThrow(/private/);
    } finally {
      await sb.cleanup();
    }
  });

  it('returns text content with status', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ body: 'hello there', contentType: 'text/plain' }),
    ) as unknown as typeof fetch;
    const sb = await mkSandbox();
    try {
      const out = await fetchTool.execute(
        { url: 'https://example.com/page' },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.status).toBe(200);
      expect(out.content).toContain('hello');
      expect(out.content_type).toBe('text/plain');
    } finally {
      await sb.cleanup();
    }
  });

  it('pretty-prints JSON when content-type is JSON', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ body: '{"a":1,"b":2}', contentType: 'application/json' }),
    ) as unknown as typeof fetch;
    const sb = await mkSandbox();
    try {
      const out = await fetchTool.execute(
        { url: 'https://api.example.com/d.json' },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.content).toContain('"a": 1');
      expect(out.content).toContain('"b": 2');
    } finally {
      await sb.cleanup();
    }
  });

  it('converts HTML to markdown by default', async () => {
    const html =
      '<html><body><h1>Title</h1><p>Hello <a href="https://x/">link</a></p><script>bad()</script></body></html>';
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ body: html, contentType: 'text/html; charset=utf-8' }),
    ) as unknown as typeof fetch;
    const sb = await mkSandbox();
    try {
      const out = await fetchTool.execute(
        { url: 'https://example.com/page' },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.content).toContain('# Title');
      expect(out.content).toContain('[link](https://x/)');
      expect(out.content).not.toContain('bad()');
    } finally {
      await sb.cleanup();
    }
  });

  it('refuses binary content-types', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ body: 'x', contentType: 'application/octet-stream' }),
    ) as unknown as typeof fetch;
    const sb = await mkSandbox();
    try {
      await expect(
        fetchTool.execute({ url: 'https://example.com/bin' }, sb.ctx, { signal: newSignal() }),
      ).rejects.toThrow(/binary/);
    } finally {
      await sb.cleanup();
    }
  });

  it('respects raw format', async () => {
    const html = '<p>raw</p>';
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ body: html, contentType: 'text/html' }),
    ) as unknown as typeof fetch;
    const sb = await mkSandbox();
    try {
      const out = await fetchTool.execute(
        { url: 'https://example.com/', format: 'raw' },
        sb.ctx,
        { signal: newSignal() },
      );
      expect(out.content).toBe('<p>raw</p>');
    } finally {
      await sb.cleanup();
    }
  });
});
