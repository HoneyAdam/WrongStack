/**
 * Tests for the official ACP registry fetcher + entry mapping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAcpRegistry,
  mapRegistryEntry,
  resolveAcpAgentCommand,
} from '../src/index.js';

describe('mapRegistryEntry', () => {
  it('maps an npx distribution to `npx -y <pkg> <args>`', () => {
    const d = mapRegistryEntry({
      id: 'cline',
      name: 'Cline',
      distribution: { npx: { package: 'cline@3.0.31', args: ['--acp'] } },
    });
    expect(d).not.toBeNull();
    expect(d?.acp.command).toBe('npx');
    expect(d?.acp.args).toEqual(['-y', 'cline@3.0.31', '--acp']);
    expect(d?.id).toBe('cline');
  });

  it('maps a uvx distribution to `uvx <pkg> <args>`', () => {
    const d = mapRegistryEntry({
      id: 'minion-code',
      distribution: { uvx: { package: 'minion-code@0.1.44', args: ['acp'] } },
    });
    expect(d?.acp.command).toBe('uvx');
    expect(d?.acp.args).toEqual(['minion-code@0.1.44', 'acp']);
  });

  it('maps a binary distribution for the requested platform (basename of cmd)', () => {
    const d = mapRegistryEntry(
      {
        id: 'goose',
        distribution: {
          binary: {
            'darwin-aarch64': { archive: 'https://x', cmd: './goose', args: ['acp'] },
          },
        },
      },
      'darwin-aarch64',
    );
    expect(d?.acp.command).toBe('goose');
    expect(d?.acp.args).toEqual(['acp']);
  });

  it('returns null when no distribution is runnable on the target platform', () => {
    const d = mapRegistryEntry(
      {
        id: 'goose',
        distribution: { binary: { 'linux-x86_64': { cmd: './goose', args: ['acp'] } } },
      },
      'darwin-aarch64',
    );
    expect(d).toBeNull();
  });

  it('infers vendor from the entry text', () => {
    expect(
      mapRegistryEntry({ id: 'claude-acp', name: 'Claude Agent', distribution: { npx: { package: 'x' } } })
        ?.vendor,
    ).toBe('anthropic');
  });
});

describe('fetchAcpRegistry', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('fetches, maps, and drops unrunnable entries', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        agents: [
          { id: 'gemini', name: 'Gemini CLI', distribution: { npx: { package: '@google/gemini-cli@1', args: ['--acp'] } } },
          { id: 'binary-only', distribution: { binary: { 'other-arch': { cmd: './x' } } } },
          { id: '', distribution: { npx: { package: 'nope' } } },
        ],
      }),
    })) as never;

    const res = await fetchAcpRegistry({ now: '2026-06-28T00:00:00Z', platformKey: 'darwin-aarch64' });
    expect(res.fetchedAt).toBe('2026-06-28T00:00:00Z');
    expect(res.agents.map((a) => a.id)).toEqual(['gemini']);
  });

  it('throws on a non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as never;
    await expect(fetchAcpRegistry()).rejects.toThrow('HTTP 503');
  });

  it('throws when the body has no agents array', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as never;
    await expect(fetchAcpRegistry()).rejects.toThrow('no agents array');
  });
});

describe('resolveAcpAgentCommand with a live registry', () => {
  const live = {
    'claude-acp': { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
    gemini: { command: 'npx', args: ['-y', '@google/gemini-cli', '--acp'] },
  };

  it('resolves our stable id via the registry alias', () => {
    // 'claude-code' (our id) → 'claude-acp' (registry id) through REGISTRY_ID_ALIASES.
    const cmd = resolveAcpAgentCommand('claude-code', undefined, live);
    expect(cmd?.command).toBe('npx');
    expect(cmd?.args).toContain('@agentclientprotocol/claude-agent-acp');
    expect(cmd?.role).toBe('claude-code');
  });

  it('resolves a registry-only id directly from live', () => {
    const cmd = resolveAcpAgentCommand('gemini', undefined, live);
    expect(cmd?.args).toContain('@google/gemini-cli');
  });

  it('user override still beats the live registry', () => {
    const cmd = resolveAcpAgentCommand(
      'claude-code',
      { 'claude-code': { command: 'my-claude' } },
      live,
    );
    expect(cmd?.command).toBe('my-claude');
  });

  it('falls back to the static catalog when live lacks the id', () => {
    const cmd = resolveAcpAgentCommand('opencode', undefined, live);
    expect(cmd?.command).toBe('opencode');
  });
});
