import * as net from 'node:net';
import { ConfigError } from '@wrongstack/core';

export function isTlsUnsafeAllowed(): boolean {
  return process.env['WRONGSTACK_UNSAFE_MCP_TLS'] === '1';
}

/**
 * Validate that an MCP transport URL is not targeting private/internal
 * addresses. This is a defense-in-depth SSRF check — MCP servers are
 * typically local or LAN, but config manipulation could point to metadata
 * endpoints (169.254.169.254) or internal services.
 *
 * The check is intentionally lighter than fetch.ts's assertNotPrivate:
 * MCP URLs are admin-configured, not LLM-supplied, so we only block
 * the most obvious attack vectors.
 */
export function validateTransportUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError({
      message: `MCP transport: invalid URL "${rawUrl}"`,
      code: 'CONFIG_INVALID',
      context: { field: 'url', rawUrl },
    });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError({
      message: `MCP transport: unsupported protocol "${url.protocol}" — only http/https allowed`,
      code: 'CONFIG_INVALID',
      context: { field: 'url', rawUrl, protocol: url.protocol },
    });
  }

  const hostname = url.hostname;
  // URL.hostname keeps the brackets on IPv6 literals; strip them so net.isIP
  // and prefix checks see the bare address.
  const host =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  // Block cloud metadata endpoints (IMDS) — these are never valid MCP servers
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    // 169.254.x.x (link-local / IMDS)
    if (parts[0] === 169 && parts[1] === 254) {
      throw new ConfigError({
        message: `MCP transport: blocked link-local/IMDS address "${hostname}" — likely not a valid MCP server`,
        code: 'CONFIG_INVALID',
        context: { field: 'url', rawUrl, hostname },
      });
    }
  } else if (ipVersion === 6) {
    const lower = host.toLowerCase();
    // fe80::/10 link-local (first hextet fe80–febf) and the AWS IPv6 IMDS
    // address fd00:ec2::254 — the IPv6 counterparts of the IPv4 block above.
    const linkLocal = /^fe[89ab]/.test(lower);
    if (linkLocal || lower === 'fd00:ec2::254') {
      throw new ConfigError({
        message: `MCP transport: blocked link-local/IMDS address "${hostname}" — likely not a valid MCP server`,
        code: 'CONFIG_INVALID',
        context: { field: 'url', rawUrl, hostname },
      });
    }
  }

  // Plaintext http: is only permitted for loopback addresses where the
  // attacker would already need machine-level access. Remote HTTP MCP servers
  // must use TLS so an active network attacker cannot read or modify tool
  // calls and responses.
  if (url.protocol === 'http:') {
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]';
    if (!isLoopback) {
      throw new ConfigError({
        message: `MCP transport: http:// is only allowed for loopback addresses; use https:// for "${hostname}"`,
        code: 'CONFIG_INVALID',
        context: { field: 'url', rawUrl, hostname, protocol: url.protocol },
      });
    }
  }
}
