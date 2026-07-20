import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config, SecretVault } from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasAnyAuthRecord } from '../src/first-run-auth-gate.js';

describe('hasAnyAuthRecord profile config routing', () => {
  let dir: string;
  let rootConfigPath: string;
  let profileConfigPath: string;

  const vault = {
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  } as SecretVault;
  const config = { providers: {} } as Config;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-first-auth-'));
    rootConfigPath = path.join(dir, 'config.json');
    profileConfigPath = path.join(dir, 'profiles', 'default', 'config.json');
    await fs.mkdir(path.dirname(profileConfigPath), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not treat provider credentials in the root bootstrap as auth', async () => {
    await fs.writeFile(
      rootConfigPath,
      JSON.stringify({ providers: { anthropic: { apiKey: 'stale-root-key' } } }),
    );
    await fs.writeFile(profileConfigPath, '{}');

    await expect(hasAnyAuthRecord({ config, profileConfigPath, vault })).resolves.toBe(false);
  });

  it('reads provider credentials from the active profile config', async () => {
    await fs.writeFile(
      profileConfigPath,
      JSON.stringify({ providers: { anthropic: { apiKey: 'profile-key' } } }),
    );

    await expect(hasAnyAuthRecord({ config, profileConfigPath, vault })).resolves.toBe(true);
  });
});
