import { assertNotPrivateHost } from '@wrongstack/core/utils';

const SAFE_SUBRESOURCE_PROTOCOLS = new Set(['about:', 'blob:', 'data:']);

export async function assertBrowserUrlAllowed(
  rawUrl: string,
  opts: { allowPrivateHosts: boolean; navigation?: boolean | undefined },
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('browser: url must be an absolute URL');
  }
  if (!opts.navigation && SAFE_SUBRESOURCE_PROTOCOLS.has(url.protocol)) return url;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`browser: unsupported protocol "${url.protocol}"`);
  }
  if (url.username || url.password) {
    throw new Error('browser: credentials in URLs are not allowed');
  }
  if (!opts.allowPrivateHosts) await assertNotPrivateHost(url.hostname);
  return url;
}

/** Remove credentials, query strings, and fragments before persistence/output. */
export function safeBrowserUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'about:blank';
  }
}

export function redactBrowserText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|token|password|secret)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );
}
