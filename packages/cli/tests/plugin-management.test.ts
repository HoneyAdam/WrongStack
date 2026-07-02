import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLUGIN_AUDIT_ENTRIES, runPluginManagementCommand } from '../src/plugin-management.js';

let tmpDir: string;
let configPath: string;

function config(overrides: Partial<Config> = {}): Config {
  return {
    features: { plugins: true },
    ...overrides,
  } as Config;
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-plugin-mgmt-'));
  configPath = path.join(tmpDir, 'config.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('plugin management', () => {
  it('exports audit entries for the TUI plugin picker', () => {
    expect(PLUGIN_AUDIT_ENTRIES.length).toBeGreaterThan(0);
    expect(PLUGIN_AUDIT_ENTRIES).toContainEqual(
      expect.objectContaining({
        name: 'secret-scanner',
        canDisable: false,
        defaultState: 'active',
      }),
    );
    expect(PLUGIN_AUDIT_ENTRIES).toContainEqual(
      expect.objectContaining({
        name: 'format-on-save',
        canDisable: true,
        defaultState: 'active',
      }),
    );
  });

  it('toggles a default-active plugin off by writing a disabled override', async () => {
    await fs.writeFile(configPath, JSON.stringify({ features: { plugins: true } }));

    const result = await runPluginManagementCommand(['toggle', 'format-on-save'], {
      config: config(),
      configPath,
    });

    expect(result.code).toBe(0);
    expect(result.patch?.plugins).toEqual([{ name: 'format-on-save', enabled: false }]);
    expect(result.patch?.features).toMatchObject({ plugins: true });
    await expect(readConfig()).resolves.toMatchObject({
      plugins: [{ name: 'format-on-save', enabled: false }],
      features: { plugins: true },
    });
  });

  it('toggles a disabled default-active plugin back on by removing the override', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        features: { plugins: true },
        plugins: [{ name: 'format-on-save', enabled: false }, 'cost-tracker'],
      }),
    );

    const result = await runPluginManagementCommand(['toggle', 'format-on-save'], {
      config: config(),
      configPath,
    });

    expect(result.code).toBe(0);
    expect(result.patch?.plugins).toEqual(['cost-tracker']);
    await expect(readConfig()).resolves.toMatchObject({
      plugins: ['cost-tracker'],
      features: { plugins: true },
    });
  });

  it('refuses to toggle locked audit entries', async () => {
    await fs.writeFile(configPath, JSON.stringify({ plugins: [] }));

    const result = await runPluginManagementCommand(['toggle', 'secret-scanner'], {
      config: config(),
      configPath,
    });

    expect(result.code).toBe(1);
    expect(result.message).toContain('locked');
    await expect(readConfig()).resolves.toEqual({ plugins: [] });
  });

  it('renders a plugin audit report with effective state and lock policy', async () => {
    const result = await runPluginManagementCommand(['report'], {
      config: config({
        plugins: [{ name: 'format-on-save', enabled: false }, 'cost-tracker', 'external-plugin'],
      }),
      configPath,
    });

    expect(result.code).toBe(0);
    expect(result.message).toContain('Plugin audit report');
    expect(result.message).toContain('secret-scanner');
    expect(result.message).toContain('locked: safety guard');
    expect(result.message).toContain('format-on-save');
    expect(result.message).toContain('disabled config');
    expect(result.message).toContain('cost-tracker');
    expect(result.message).toContain('enabled  config');
    expect(result.message).toContain('external-plugin');
    expect(result.message).toContain('risk=custom');
  });

  it('uses the audit report as the non-interactive menu fallback', async () => {
    const result = await runPluginManagementCommand(['menu'], {
      config: config(),
      configPath,
    });

    expect(result.code).toBe(0);
    expect(result.message).toContain('Plugin audit report');
    expect(result.message).toContain('/plugin menu');
  });

  it('canonicalizes the legacy Telegram package spec when toggling', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        features: { plugins: true },
        plugins: ['@wrongstack/telegram'],
      }),
    );

    const result = await runPluginManagementCommand(['toggle', '@wrongstack/telegram'], {
      config: config(),
      configPath,
    });

    expect(result.code).toBe(0);
    expect(result.patch?.plugins).toEqual([{ name: 'telegram', enabled: false }]);
    await expect(readConfig()).resolves.toMatchObject({
      plugins: [{ name: 'telegram', enabled: false }],
    });
  });
});
