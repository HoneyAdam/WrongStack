import { createHash } from 'node:crypto';
import * as http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  authorizationHeaderForToken,
  authorizationServerMetadataUrls,
  canonicalMcpResource,
  createMcpAuthorizationRequest,
  discoverMcpAuthorization,
  exchangeMcpAuthorizationCode,
  type MCPAuthorizationProvider,
  parseAuthorizationServerMetadata,
  parseMcpAuthorizationCallback,
  parseMcpBearerChallenge,
  parseProtectedResourceMetadata,
  protectedResourceMetadataUrls,
  refreshMcpAccessToken,
} from '../src/authorization.js';
import { StreamableHTTPTransport } from '../src/transport.js';

const INIT_RESULT = {
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  serverInfo: { name: 'auth-fixture', version: '1.0.0' },
};

describe('MCP authorization primitives', () => {
  it('builds a canonical resource and enforces token audience binding', () => {
    expect(canonicalMcpResource('https://MCP.Example.com/')).toBe('https://mcp.example.com');
    expect(canonicalMcpResource('https://mcp.example.com/team/mcp')).toBe(
      'https://mcp.example.com/team/mcp',
    );
    expect(
      authorizationHeaderForToken(
        { accessToken: 'secret-token', resource: 'https://mcp.example.com' },
        'https://mcp.example.com',
      ),
    ).toBe('Bearer secret-token');
    expect(() =>
      authorizationHeaderForToken(
        { accessToken: 'secret-token', resource: 'https://other.example.com' },
        'https://mcp.example.com',
      ),
    ).toThrow(/resource does not match/);
  });

  it('rejects expired, non-bearer, and header-injection tokens', () => {
    expect(() =>
      authorizationHeaderForToken(
        { accessToken: 'old', resource: 'https://mcp.example.com', expiresAt: 99 },
        'https://mcp.example.com',
        100,
      ),
    ).toThrow(/expired/);
    expect(() =>
      authorizationHeaderForToken(
        { accessToken: 'token', tokenType: 'MAC', resource: 'https://mcp.example.com' },
        'https://mcp.example.com',
      ),
    ).toThrow(/token type/);
    expect(() =>
      authorizationHeaderForToken(
        { accessToken: 'token\r\nX-Evil: yes', resource: 'https://mcp.example.com' },
        'https://mcp.example.com',
      ),
    ).toThrow(/invalid characters/);
  });

  it('parses bounded bearer challenge metadata and scopes', () => {
    expect(
      parseMcpBearerChallenge(
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read files:write files:read"',
        'https://mcp.example.com/mcp',
      ),
    ).toEqual({
      status: 401,
      resource: 'https://mcp.example.com/mcp',
      resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
      scopes: ['files:read', 'files:write'],
      rawScheme: 'Bearer',
    });
    expect(
      parseMcpBearerChallenge(
        'Bearer resource_metadata="http://169.254.169.254/latest"',
        'https://mcp.example.com/mcp',
      ).resourceMetadataUrl,
    ).toBeUndefined();
  });

  it('constructs protected-resource and authorization-server discovery order', () => {
    expect(protectedResourceMetadataUrls('https://mcp.example.com/team/mcp')).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/team/mcp',
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    ]);
    expect(authorizationServerMetadataUrls('https://auth.example.com/tenant1')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://auth.example.com/.well-known/openid-configuration/tenant1',
      'https://auth.example.com/tenant1/.well-known/openid-configuration',
    ]);
  });

  it('validates protected-resource audience and PKCE-capable authorization metadata', () => {
    expect(
      parseProtectedResourceMetadata(
        {
          resource: 'https://mcp.example.com/team/mcp',
          authorization_servers: ['https://auth.example.com/tenant1'],
          scopes_supported: ['tools:read', 'tools:read'],
        },
        'https://mcp.example.com/team/mcp',
      ),
    ).toEqual({
      resource: 'https://mcp.example.com/team/mcp',
      authorizationServers: ['https://auth.example.com/tenant1'],
      scopesSupported: ['tools:read'],
    });
    expect(
      parseAuthorizationServerMetadata(
        {
          issuer: 'https://auth.example.com/tenant1',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          code_challenge_methods_supported: ['S256'],
        },
        'https://auth.example.com/tenant1',
      ),
    ).toMatchObject({
      issuer: 'https://auth.example.com/tenant1',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
    });

    expect(() =>
      parseProtectedResourceMetadata(
        {
          resource: 'https://other.example.com',
          authorization_servers: ['https://auth.example.com'],
        },
        'https://mcp.example.com',
      ),
    ).toThrow(/does not match/);
    expect(() =>
      parseAuthorizationServerMetadata(
        {
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          code_challenge_methods_supported: ['plain'],
        },
        'https://auth.example.com',
      ),
    ).toThrow(/PKCE S256/);
  });

  it('orchestrates RFC 9728 then RFC 8414/OIDC fallback order', async () => {
    const requested: string[] = [];
    const responses = new Map<string, unknown>([
      [
        'https://mcp.example.com/.well-known/oauth-protected-resource',
        {
          resource: 'https://mcp.example.com/team/mcp',
          authorization_servers: ['https://auth.example.com/tenant1'],
        },
      ],
      [
        'https://auth.example.com/.well-known/openid-configuration/tenant1',
        {
          issuer: 'https://auth.example.com/tenant1',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          code_challenge_methods_supported: ['S256'],
        },
      ],
    ]);
    const result = await discoverMcpAuthorization('https://mcp.example.com/team/mcp', {
      fetchJson: async (url) => {
        requested.push(url);
        return responses.get(url);
      },
    });

    expect(requested).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/team/mcp',
      'https://mcp.example.com/.well-known/oauth-protected-resource',
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://auth.example.com/.well-known/openid-configuration/tenant1',
    ]);
    expect(result).toMatchObject({
      resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
      authorizationServerMetadataUrl:
        'https://auth.example.com/.well-known/openid-configuration/tenant1',
    });
  });

  it('uses challenge metadata as authoritative instead of silently falling back', async () => {
    const requested: string[] = [];
    await expect(
      discoverMcpAuthorization('https://mcp.example.com/mcp', {
        challengeHeader:
          'Bearer resource_metadata="https://mcp.example.com/custom-metadata", scope="tools:read"',
        fetchJson: async (url) => {
          requested.push(url);
          return { resource: 'https://wrong.example.com', authorization_servers: [] };
        },
      }),
    ).rejects.toThrow(/protected resource metadata discovery failed/);
    expect(requested).toEqual(['https://mcp.example.com/custom-metadata']);
  });

  it('performs pinned loopback discovery for local development', async () => {
    let origin = '';
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/.well-known/oauth-protected-resource/mcp') {
        response.end(
          JSON.stringify({
            resource: `${origin}/mcp`,
            authorization_servers: [`${origin}/auth`],
            scopes_supported: ['tools:read'],
          }),
        );
        return;
      }
      if (request.url === '/.well-known/oauth-authorization-server/auth') {
        response.end(
          JSON.stringify({
            issuer: `${origin}/auth`,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            code_challenge_methods_supported: ['S256'],
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    origin = `http://127.0.0.1:${address.port}`;
    try {
      const result = await discoverMcpAuthorization(`${origin}/mcp`);
      expect(result.protectedResource.resource).toBe(`${origin}/mcp`);
      expect(result.authorizationServer.tokenEndpoint).toBe(`${origin}/token`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('blocks a public discovery hostname that resolves to a private address', async () => {
    await expect(
      discoverMcpAuthorization('https://mcp.example.com/mcp', {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
    ).rejects.toThrow(/blocked private address/);
  });

  it('does not follow discovery redirects', async () => {
    let redirectedHits = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/redirected') {
        redirectedHits += 1;
        response.setHeader('content-type', 'application/json');
        response.end('{}');
        return;
      }
      response.statusCode = 302;
      response.setHeader('location', '/redirected');
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    try {
      await expect(
        discoverMcpAuthorization(`http://127.0.0.1:${address.port}/mcp`),
      ).rejects.toThrow(/redirects are not allowed/);
      expect(redirectedHits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('creates PKCE S256 authorization requests and validates callback state', () => {
    const session = createMcpAuthorizationRequest({
      authorizationServer: {
        issuer: 'https://auth.example.com',
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        scopesSupported: ['tools:read'],
      },
      clientId: 'wrongstack-public-client',
      redirectUri: 'http://127.0.0.1:43123/callback',
      resource: 'https://mcp.example.com/team/mcp',
      scopes: ['tools:read', 'tools:read'],
    });
    const authorizationUrl = new URL(session.authorizationUrl);
    const expectedChallenge = createHash('sha256').update(session.codeVerifier).digest('base64url');

    expect(authorizationUrl.searchParams.get('code_challenge')).toBe(expectedChallenge);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('resource')).toBe('https://mcp.example.com/team/mcp');
    expect(authorizationUrl.searchParams.get('scope')).toBe('tools:read');
    expect(
      parseMcpAuthorizationCallback(
        `http://127.0.0.1:43123/callback?code=auth-code&state=${session.state}`,
        session,
      ),
    ).toBe('auth-code');
    expect(() =>
      parseMcpAuthorizationCallback(
        'http://127.0.0.1:43123/callback?code=auth-code&state=wrong',
        session,
      ),
    ).toThrow(/state mismatch/);
  });

  it('exchanges and rotates tokens with mandatory resource indicators', async () => {
    const requests: URLSearchParams[] = [];
    let origin = '';
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const form = new URLSearchParams(body);
        requests.push(form);
        response.setHeader('content-type', 'application/json');
        if (form.get('grant_type') === 'authorization_code') {
          response.end(
            JSON.stringify({
              access_token: 'access-one',
              refresh_token: 'refresh-one',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'tools:read',
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            access_token: 'access-two',
            refresh_token: 'refresh-two',
            token_type: 'bearer',
            expires_in: 1800,
            scope: 'tools:read',
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    origin = `http://127.0.0.1:${address.port}`;
    const authorizationServer = {
      issuer: `${origin}/auth`,
      authorizationEndpoint: `${origin}/authorize`,
      tokenEndpoint: `${origin}/token`,
      scopesSupported: ['tools:read'],
    };
    const session = createMcpAuthorizationRequest({
      authorizationServer,
      clientId: 'wrongstack-client',
      redirectUri: `${origin}/callback`,
      resource: `${origin}/mcp`,
      scopes: ['tools:read'],
    });
    try {
      const first = await exchangeMcpAuthorizationCode({
        authorizationServer,
        clientId: session.clientId,
        redirectUri: session.redirectUri,
        resource: session.resource,
        code: 'authorization-code',
        codeVerifier: session.codeVerifier,
      });
      const refreshed = await refreshMcpAccessToken({
        authorizationServer,
        clientId: session.clientId,
        resource: session.resource,
        refreshToken: first.refreshToken!,
      });

      expect(first).toMatchObject({
        accessToken: 'access-one',
        refreshToken: 'refresh-one',
        resource: `${origin}/mcp`,
        scopes: ['tools:read'],
      });
      expect(refreshed).toMatchObject({
        accessToken: 'access-two',
        refreshToken: 'refresh-two',
        resource: `${origin}/mcp`,
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]?.get('resource')).toBe(`${origin}/mcp`);
      expect(requests[0]?.get('code_verifier')).toBe(session.codeVerifier);
      expect(requests[1]?.get('resource')).toBe(`${origin}/mcp`);
      expect(requests[1]?.get('refresh_token')).toBe('refresh-one');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('HTTP transport authorization provider', () => {
  it('refreshes after one 401 challenge and retries with the replacement token', async () => {
    const originalFetch = globalThis.fetch;
    const seenAuthorization: string[] = [];
    const seenProtocolVersion: Array<string | null> = [];
    let token = 'old-token';
    const handleUnauthorized = vi.fn<NonNullable<MCPAuthorizationProvider['handleUnauthorized']>>(
      async (challenge) => {
        expect(challenge).toMatchObject({
          resourceMetadataUrl: 'https://m.test/.well-known/oauth-protected-resource',
          scopes: ['tools:read'],
        });
        token = 'new-token';
        return true;
      },
    );
    const provider: MCPAuthorizationProvider = {
      getAccessToken: async ({ resource }) => ({ accessToken: token, resource }),
      handleUnauthorized,
    };
    let initializeCalls = 0;
    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenAuthorization.push(headers.get('authorization') ?? '');
      seenProtocolVersion.push(headers.get('mcp-protocol-version'));
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.method === 'initialize') {
        initializeCalls += 1;
        if (initializeCalls === 1) {
          return new Response('unauthorized', {
            status: 401,
            headers: {
              'www-authenticate':
                'Bearer resource_metadata="https://m.test/.well-known/oauth-protected-resource", scope="tools:read"',
            },
          });
        }
        return Response.json({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
      }
      if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [] } });
    }) as typeof fetch;

    try {
      const transport = new StreamableHTTPTransport({
        name: 'auth-server',
        url: 'https://m.test/mcp',
        authorizationProvider: provider,
      });
      await transport.connect();

      expect(handleUnauthorized).toHaveBeenCalledOnce();
      expect(initializeCalls).toBe(2);
      expect(seenAuthorization.slice(0, 2)).toEqual(['Bearer old-token', 'Bearer new-token']);
      expect(seenProtocolVersion.slice(0, 2)).toEqual([null, null]);
      expect(seenProtocolVersion.slice(2)).toEqual(['2025-06-18', '2025-06-18']);
      await transport.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('never retries a second 401 response', async () => {
    const originalFetch = globalThis.fetch;
    const handleUnauthorized = vi.fn(async () => true);
    const provider: MCPAuthorizationProvider = {
      getAccessToken: async ({ resource }) => ({ accessToken: 'token', resource }),
      handleUnauthorized,
    };
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const transport = new StreamableHTTPTransport({
        name: 'auth-server',
        url: 'https://m.test/mcp',
        authorizationProvider: provider,
      });
      await expect(transport.connect()).rejects.toThrow(/initialize HTTP 401/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(handleUnauthorized).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
