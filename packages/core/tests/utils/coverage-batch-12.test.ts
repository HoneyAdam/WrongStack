import { describe, it, expect } from 'vitest';
import { AGENT_STALE_MS, CLIENT_STALE_MS, HEARTBEAT_THROTTLE_MS, REGISTRY_CACHE_TTL_MS, MESSAGE_CACHE_MAX_ENTRIES, MAILBOX_AWARENESS_INTERVAL_MS, AUTO_COMPACT_INTERVAL_MS, AUTO_COMPACT_READ_MAX_AGE_MS, AUTO_COMPACT_DEFAULT_TTL_MS, HTTP_RATE_LIMIT_PER_MINUTE, HTTP_RATE_LIMIT_WINDOW_MS } from '../../src/coordination/mailbox-constants.js';
import { DISCOVERY_AGENTS } from '../../src/coordination/agents/phase1-discovery.js';
import { TECHSTACK_AGENTS } from '../../src/coordination/agents/phase3-techstack.js';
import { KNOWLEDGE_AGENTS } from '../../src/coordination/agents/phase7-knowledge.js';
import { createSecurityPlugin } from '../../src/plugins/security-plugin.js';

// ── mailbox-constants ────────────────────────────────────────────────────

describe('mailbox-constants', () => {
  it('has sensible values', () => {
    expect(AGENT_STALE_MS).toBe(60_000);
    expect(CLIENT_STALE_MS).toBe(60_000);
    expect(HEARTBEAT_THROTTLE_MS).toBe(5_000);
    expect(REGISTRY_CACHE_TTL_MS).toBe(2_000);
    expect(MESSAGE_CACHE_MAX_ENTRIES).toBe(10_000);
    expect(MAILBOX_AWARENESS_INTERVAL_MS).toBe(30_000);
    expect(AUTO_COMPACT_INTERVAL_MS).toBe(300_000);
    expect(AUTO_COMPACT_READ_MAX_AGE_MS).toBe(600_000);
    expect(AUTO_COMPACT_DEFAULT_TTL_MS).toBe(86_400_000);
    expect(HTTP_RATE_LIMIT_PER_MINUTE).toBe(120);
    expect(HTTP_RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('registry cache TTL is shorter than heartbeat throttle', () => {
    expect(REGISTRY_CACHE_TTL_MS).toBeLessThan(HEARTBEAT_THROTTLE_MS);
  });

  it('agent stale is longer than heartbeat interval', () => {
    expect(AGENT_STALE_MS).toBeGreaterThanOrEqual(HEARTBEAT_THROTTLE_MS);
  });
});

// ── agent definition arrays ──────────────────────────────────────────────

function assertValidAgents(label: string, agents: any[]) {
  describe(label, () => {
    it('has at least one agent', () => {
      expect(agents.length).toBeGreaterThan(0);
    });
    it('every agent has config with id, name, role, tools, prompt', () => {
      for (const a of agents) {
        expect(a.config.id).toBeTruthy();
        expect(a.config.name).toBeTruthy();
        expect(a.config.role).toBeTruthy();
        expect(Array.isArray(a.config.tools)).toBe(true);
        expect(a.config.prompt).toBeTruthy();
      }
    });
    it('every agent has budget and capability', () => {
      for (const a of agents) {
        expect(a.budget).toBeDefined();
        expect(a.capability).toBeDefined();
        expect(a.capability.phase).toBeTruthy();
        expect(a.capability.summary).toBeTruthy();
        expect(Array.isArray(a.capability.keywords)).toBe(true);
        expect(a.capability.keywords.length).toBeGreaterThan(0);
      }
    });
    it('agent ids are unique', () => {
      const ids = agents.map((a: any) => a.config.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
}

assertValidAgents('DISCOVERY_AGENTS', DISCOVERY_AGENTS);
assertValidAgents('TECHSTACK_AGENTS', TECHSTACK_AGENTS);
assertValidAgents('KNOWLEDGE_AGENTS', KNOWLEDGE_AGENTS);

describe('DISCOVERY_AGENTS specific', () => {
  it('includes explore, search, and research agents', () => {
    const ids = DISCOVERY_AGENTS.map((a: any) => a.config.id);
    expect(ids).toContain('explore');
    expect(ids).toContain('search');
    expect(ids).toContain('research');
  });
});

// ── security-plugin ──────────────────────────────────────────────────────

describe('createSecurityPlugin', () => {
  it('returns a valid plugin object', () => {
    const plugin = createSecurityPlugin();
    expect(plugin.name).toBe('wstack-security');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.description).toBeTruthy();
    expect(plugin.apiVersion).toMatch(/^\^/);
    expect(plugin.capabilities).toBeDefined();
    expect(plugin.defaultConfig).toBeDefined();
  });

  it('setup does not throw', () => {
    const plugin = createSecurityPlugin();
    const logs: string[] = [];
    plugin.setup({ log: { info: (m: string) => logs.push(m) } } as any);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('teardown does not throw', () => {
    const plugin = createSecurityPlugin();
    const logs: string[] = [];
    expect(() => plugin.teardown({ log: { info: (m: string) => logs.push(m) } } as any)).not.toThrow();
  });

  it('health returns ok', async () => {
    const plugin = createSecurityPlugin();
    const result = await plugin.health();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('security');
  });
});
