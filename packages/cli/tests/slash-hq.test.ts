import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripAnsi } from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHqCommand } from '../src/slash-commands/hq.js';
import type { SlashCommandContext } from '../src/slash-commands/index.js';

function makeCtx(config: Record<string, unknown> = {}): { ctx: SlashCommandContext; globalConfig: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'wstack-hq-test-'));
  const globalConfig = path.join(dir, 'global', 'config.json');
  const inProjectConfig = path.join(dir, 'project', 'config.json');
  const store = { get: vi.fn(() => config), update: vi.fn() };
  const ctx = { configStore: store, paths: { globalConfig, inProjectConfig } } as never as SlashCommandContext;
  return { ctx, globalConfig };
}

// Keep status resolution deterministic: no env overrides, no local HQ marker.
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = {
    url: process.env['WRONGSTACK_HQ_URL'],
    token: process.env['WRONGSTACK_HQ_TOKEN'],
    enabled: process.env['WRONGSTACK_HQ_ENABLED'],
    dataDir: process.env['WRONGSTACK_HQ_DATA_DIR'],
  };
  delete process.env['WRONGSTACK_HQ_URL'];
  delete process.env['WRONGSTACK_HQ_TOKEN'];
  delete process.env['WRONGSTACK_HQ_ENABLED'];
  process.env['WRONGSTACK_HQ_DATA_DIR'] = mkdtempSync(path.join(tmpdir(), 'wstack-hq-dd-'));
});
afterEach(() => {
  for (const [k, v] of Object.entries({
    WRONGSTACK_HQ_URL: savedEnv.url,
    WRONGSTACK_HQ_TOKEN: savedEnv.token,
    WRONGSTACK_HQ_ENABLED: savedEnv.enabled,
    WRONGSTACK_HQ_DATA_DIR: savedEnv.dataDir,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('/hq slash command', () => {
  it('reports name and category', () => {
    const cmd = buildHqCommand(makeCtx());
    expect(cmd.name).toBe('hq');
    expect(cmd.category).toBe('Config');
    expect(cmd.description.toLowerCase()).toContain('hq');
  });

  it('set <url> <token> persists url, token, and enabled to global config', async () => {
    const { ctx, globalConfig } = makeCtx();
    const res = await buildHqCommand(ctx).run!('set http://127.0.0.1:59999 my-token');
    expect(stripAnsi(res!.message!)).toContain('http://127.0.0.1:59999');
    const written = JSON.parse(readFileSync(globalConfig, 'utf8'));
    expect(written.hq.url).toBe('http://127.0.0.1:59999');
    expect(written.hq.enabled).toBe(true);
    expect(written.hq.token).toBe('my-token');
  });

  it('set rejects a non-http URL without writing', async () => {
    const { ctx, globalConfig } = makeCtx();
    const res = await buildHqCommand(ctx).run!('set not-a-url');
    expect(stripAnsi(res!.message!)).toContain('Invalid URL');
    expect(existsSync(globalConfig)).toBe(false);
  });

  it('set with no url shows usage', async () => {
    const { ctx } = makeCtx();
    const res = await buildHqCommand(ctx).run!('set');
    expect(stripAnsi(res!.message!)).toContain('Usage:');
  });

  it('on / off toggles hq.enabled', async () => {
    const { ctx, globalConfig } = makeCtx();
    await buildHqCommand(ctx).run!('on');
    expect(JSON.parse(readFileSync(globalConfig, 'utf8')).hq.enabled).toBe(true);
    await buildHqCommand(ctx).run!('off');
    expect(JSON.parse(readFileSync(globalConfig, 'utf8')).hq.enabled).toBe(false);
  });

  it('clear removes the hq section', async () => {
    const { ctx, globalConfig } = makeCtx({ hq: { url: 'http://x:3499', enabled: true } });
    await buildHqCommand(ctx).run!('clear');
    const written = JSON.parse(readFileSync(globalConfig, 'utf8'));
    expect(written.hq).toBeUndefined();
  });

  it('bare /hq shows "Not configured" when nothing is set', async () => {
    const { ctx } = makeCtx();
    const res = await buildHqCommand(ctx).run!('');
    expect(stripAnsi(res!.message!)).toContain('Not configured');
  });

  it('status shows the configured url and source', async () => {
    const { ctx } = makeCtx({ hq: { url: 'http://127.0.0.1:59998', enabled: true } });
    const res = await buildHqCommand(ctx).run!('status');
    const text = stripAnsi(res!.message!);
    expect(text).toContain('http://127.0.0.1:59998');
    expect(text).toContain('config.json');
  });
});
