import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { noOpVault } from '@wrongstack/core/security';
import { DefaultSecretVault } from '@wrongstack/core/security';
import { afterEach, describe, expect, it } from 'vitest';
import type { MCPAuthorizationServerMetadata } from '../src/authorization.js';
import {
  createVaultBackedMcpAuthorizationProviderFactory,
  MCPRefreshingAuthorizationProvider,
  type MCPStoredAuthorization,
  MCPVaultTokenStore,
} from '../src/token-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('MCP vault token store', () => {
  it('persists only encrypted token material and restores the authorization state', async () => {
    const fixture = await createFixture();
    const value = storedAuthorization('alpha', 'https://mcp.example.com/team', {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
    });

    await fixture.store.save(value);

    const raw = await fs.readFile(fixture.storePath, 'utf8');
    expect(raw).not.toContain('access-secret');
    expect(raw).not.toContain('refresh-secret');
    expect(raw).toContain('enc:v1:');
    await expect(fixture.store.load(value.serverName, value.resource)).resolves.toEqual(value);
  });

  it('serializes concurrent cross-surface updates without losing entries', async () => {
    const fixture = await createFixture();
    const secondStore = new MCPVaultTokenStore(fixture.storePath, fixture.vault);
    const first = storedAuthorization('alpha', 'https://one.example.com/mcp');
    const second = storedAuthorization('beta', 'https://two.example.com/mcp');

    await Promise.all([fixture.store.save(first), secondStore.save(second)]);

    await expect(fixture.store.load(first.serverName, first.resource)).resolves.toEqual(first);
    await expect(fixture.store.load(second.serverName, second.resource)).resolves.toEqual(second);
  });

  it('rejects plaintext token material on disk and a non-encrypting vault', async () => {
    const fixture = await createFixture();
    const value = storedAuthorization('alpha', 'https://mcp.example.com/mcp');
    await fs.writeFile(
      fixture.storePath,
      JSON.stringify({
        version: 1,
        updatedAt: value.updatedAt,
        entries: [
          {
            serverName: value.serverName,
            resource: value.resource,
            clientId: value.clientId,
            authorizationServer: value.authorizationServer,
            accessToken: 'plaintext-access',
            refreshToken: 'plaintext-refresh',
            tokenType: 'Bearer',
            scopes: [],
            updatedAt: value.updatedAt,
          },
        ],
      }),
    );

    await expect(fixture.store.load(value.serverName, value.resource)).rejects.toThrow(
      /unencrypted token/,
    );
    const unsafeStore = new MCPVaultTokenStore(
      path.join(fixture.directory, 'unsafe.json'),
      noOpVault,
    );
    await expect(unsafeStore.save(value)).rejects.toThrow(/encrypting SecretVault/);
  });

  it('removes only the exact server and resource binding', async () => {
    const fixture = await createFixture();
    const first = storedAuthorization('alpha', 'https://mcp.example.com/one');
    const second = storedAuthorization('alpha', 'https://mcp.example.com/two');
    await fixture.store.save(first);
    await fixture.store.save(second);

    await expect(fixture.store.remove(first.serverName, first.resource)).resolves.toBe(true);
    await expect(fixture.store.load(first.serverName, first.resource)).resolves.toBeUndefined();
    await expect(fixture.store.load(second.serverName, second.resource)).resolves.toEqual(second);
  });
});

describe('MCP refreshing authorization provider', () => {
  it('single-flights proactive refresh and persists rotated tokens', async () => {
    const fixture = await createFixture();
    let refreshCalls = 0;
    let origin = '';
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        refreshCalls += 1;
        const form = new URLSearchParams(body);
        expect(form.get('grant_type')).toBe('refresh_token');
        expect(form.get('refresh_token')).toBe('refresh-old');
        expect(form.get('resource')).toBe(`${origin}/mcp`);
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            access_token: 'access-new',
            refresh_token: 'refresh-new',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'tools:read',
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    origin = `http://127.0.0.1:${address.port}`;
    const value = storedAuthorization('alpha', `${origin}/mcp`, {
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      expiresAt: Date.now() + 500,
      authorizationServer: {
        issuer: `${origin}/auth`,
        authorizationEndpoint: `${origin}/authorize`,
        tokenEndpoint: `${origin}/token`,
        scopesSupported: ['tools:read'],
      },
    });
    await fixture.store.save(value);
    const provider = new MCPRefreshingAuthorizationProvider({
      serverName: value.serverName,
      resource: value.resource,
      store: fixture.store,
    });
    const context = { serverName: value.serverName, resource: value.resource };

    try {
      const results = await Promise.all([
        provider.getAccessToken(context),
        provider.getAccessToken(context),
        provider.getAccessToken(context),
      ]);

      expect(refreshCalls).toBe(1);
      expect(results.map((token) => token?.accessToken)).toEqual([
        'access-new',
        'access-new',
        'access-new',
      ]);
      await expect(fixture.store.load(value.serverName, value.resource)).resolves.toMatchObject({
        tokenSet: { accessToken: 'access-new', refreshToken: 'refresh-new' },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reuses providers per HTTP server and leaves stdio servers unauthenticated', async () => {
    const fixture = await createFixture();
    const factory = createVaultBackedMcpAuthorizationProviderFactory({ store: fixture.store });
    const config = {
      name: 'remote',
      transport: 'streamable-http' as const,
      url: 'https://mcp.example.com/mcp',
    };

    expect(factory(config)).toBe(factory(config));
    expect(factory({ name: 'local', transport: 'stdio', command: 'mcp-server' })).toBeUndefined();
  });
});

async function createFixture(): Promise<{
  directory: string;
  storePath: string;
  vault: DefaultSecretVault;
  store: MCPVaultTokenStore;
}> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-mcp-token-store-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'mcp-auth.json');
  const vault = new DefaultSecretVault({ keyFile: path.join(directory, '.key') });
  return { directory, storePath, vault, store: new MCPVaultTokenStore(storePath, vault) };
}

function storedAuthorization(
  serverName: string,
  resource: string,
  overrides: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    authorizationServer?: MCPAuthorizationServerMetadata;
  } = {},
): MCPStoredAuthorization {
  return {
    serverName,
    resource,
    clientId: 'wrongstack-client',
    authorizationServer:
      overrides.authorizationServer ??
      ({
        issuer: 'https://auth.example.com/tenant',
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        scopesSupported: ['tools:read'],
      } satisfies MCPAuthorizationServerMetadata),
    tokenSet: {
      accessToken: overrides.accessToken ?? 'access-token',
      refreshToken: overrides.refreshToken ?? 'refresh-token',
      tokenType: 'Bearer',
      resource,
      expiresAt: overrides.expiresAt,
      scopes: ['tools:read'],
    },
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}
