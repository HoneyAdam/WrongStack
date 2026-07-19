import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DefaultSecretVault } from '@wrongstack/core/security';
import { persistPrefsToConfig } from '@wrongstack/webui-server';
import { describe, expect, it } from 'vitest';

describe('persistPrefsToConfig', () => {
  it('persists YOLO to both autonomy.yolo and top-level yolo', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wstack-webui-prefs-'));
    const profileConfigPath = path.join(dir, 'config.json');
    writeFileSync(
      profileConfigPath,
      JSON.stringify({ version: 1, autonomy: { yolo: false }, yolo: false }),
      'utf8',
    );

    await persistPrefsToConfig(
      {
        globalConfigPath: path.join(dir, 'root.json'),
        profileConfigPath,
        vault: new DefaultSecretVault({ keyFile: path.join(dir, '.key') }),
        logger: { warn: () => undefined },
      },
      { lock: Promise.resolve() },
      { yolo: true },
    );

    const written = JSON.parse(readFileSync(profileConfigPath, 'utf8')) as {
      autonomy?: { yolo?: boolean };
      yolo?: boolean;
    };
    expect(written.autonomy?.yolo).toBe(true);
    expect(written.yolo).toBe(true);
  });

  it('persists model matrix entries with route-specific runtime overrides', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wstack-webui-prefs-'));
    const profileConfigPath = path.join(dir, 'config.json');
    writeFileSync(profileConfigPath, JSON.stringify({ version: 1 }), 'utf8');

    await persistPrefsToConfig(
      {
        globalConfigPath: path.join(dir, 'root.json'),
        profileConfigPath,
        vault: new DefaultSecretVault({ keyFile: path.join(dir, '.key') }),
        logger: { warn: () => undefined },
      },
      { lock: Promise.resolve() },
      {
        modelMatrix: {
          planner: {
            fallbackProfile: 'cheap',
            modelRuntime: {
              reasoning: { mode: 'on', effort: 'low', preserve: false },
              cache: { ttl: '5m' },
              parameters: { user: 'planner' },
            },
          },
        },
      },
    );

    const written = JSON.parse(readFileSync(profileConfigPath, 'utf8')) as {
      modelMatrix?: Record<string, unknown>;
    };
    expect(written.modelMatrix).toEqual({
      planner: {
        fallbackProfile: 'cheap',
        modelRuntime: {
          reasoning: { mode: 'on', effort: 'low', preserve: false },
          cache: { ttl: '5m' },
          parameters: { user: 'planner' },
        },
      },
    });
  });
});
