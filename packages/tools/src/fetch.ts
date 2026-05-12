import * as dns from 'node:dns/promises';
import type { Tool } from '@wrongstack/core';
import { truncateMiddle } from './_util.js';

interface FetchInput {
  url: string;
  format?: 'markdown' | 'text' | 'raw';
}

interface FetchOutput {
  content: string;
  status: number;
  content_type: string;
  url: string;
}

const MAX_BYTES = 131_072;
const TIMEOUT_MS = 20_000;

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/i,
  /^fe80:/i,
];

const ALLOW_PRIVATE = process.env['WRONGSTACK_FETCH_ALLOW_PRIVATE'] === '1';

async function fetchWithRedirectLimit(
  url: string,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<Response> {
  const headers = {
    'user-agent': 'WrongStack/1.0 (+https://wrongstack.com)',
    accept: 'text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1',
  };
  let redirectCount = 0;
  let currentUrl = url;
  for (;;) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      signal,
      headers,
    });
    if (res.status < 300 || res.status > 399) {
      return res;
    }
    redirectCount++;
    if (redirectCount > maxRedirects) {
      throw new Error(`fetch: exceeded ${maxRedirects} redirects`);
    }
    const location = res.headers.get('location');
    if (!location) {
      throw new Error('fetch: redirect status with no location header');
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
}

export const fetchTool: Tool<FetchInput, FetchOutput> = {
  name: 'fetch',
  description: 'Fetch the contents of a URL. HTML is converted to markdown by default.',
  usageHint:
    'HTTPS only by default. Localhost and RFC1918 ranges blocked unless WRONGSTACK_FETCH_ALLOW_PRIVATE=1. Max 5 redirects, 20s timeout, 128KB cap.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: TIMEOUT_MS,
  maxOutputBytes: MAX_BYTES,
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      format: { type: 'string', enum: ['markdown', 'text', 'raw'] },
    },
    required: ['url'],
  },
  async execute(input, _ctx, opts) {
    if (!input?.url) throw new Error('fetch: url is required');
    const u = new URL(input.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error(`fetch: unsupported protocol "${u.protocol}"`);
    }
    if (u.protocol === 'http:' && !ALLOW_PRIVATE) {
      throw new Error('fetch: http:// blocked (HTTPS required by default)');
    }
    await assertNotPrivate(u.hostname);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('fetch timeout')), TIMEOUT_MS);
    const combined = combineSignals(opts.signal, ctrl.signal);

    try {
      const res = await fetchWithRedirectLimit(input.url, 5, combined);

      const ct = res.headers.get('content-type') ?? 'application/octet-stream';
      if (/^image\/|^audio\/|^video\/|application\/octet-stream/.test(ct)) {
        throw new Error(`fetch: refusing to read binary content-type "${ct}"`);
      }

      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          received += value.byteLength;
          chunks.push(value);
          if (received > MAX_BYTES) break;
        }
      }
      const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');

      const format = input.format ?? (ct.includes('text/html') ? 'markdown' : 'text');
      let content: string;
      if (format === 'raw') content = text;
      else if (format === 'markdown' && ct.includes('text/html')) content = htmlToMarkdown(text);
      else if (ct.includes('application/json')) content = prettyJson(text);
      else content = text;

      return {
        content: truncateMiddle(content, MAX_BYTES),
        status: res.status,
        content_type: ct,
        url: res.url,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

async function assertNotPrivate(hostname: string): Promise<void> {
  if (ALLOW_PRIVATE) return;
  if (PRIVATE_RANGES.some((r) => r.test(hostname))) {
    throw new Error(`fetch: blocked private/loopback address "${hostname}"`);
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('fetch: blocked localhost target');
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const r of records) {
      if (PRIVATE_RANGES.some((re) => re.test(r.address))) {
        throw new Error(`fetch: resolved to private address ${r.address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('fetch:')) throw err;
    // DNS failure — let fetch handle it
  }
}

function combineSignals(...sigs: AbortSignal[]): AbortSignal {
  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return (AbortSignal as { any: (s: AbortSignal[]) => AbortSignal }).any(sigs);
  }
  const ctrl = new AbortController();
  for (const s of sigs) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function htmlToMarkdown(html: string): string {
  let s = html;
  // Strip scripts/styles
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Headings
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, c) => {
    return '\n' + '#'.repeat(Number(n)) + ' ' + stripTags(c).trim() + '\n';
  });
  // Bold / italic
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  // Links
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  // Code
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c) => '\n```\n' + stripTags(c) + '\n```\n');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  // Lists
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  // Breaks / paragraphs
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  // Strip remaining tags
  s = stripTags(s);
  // Decode common entities
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
