/**
 * Focused unit tests for HQ first-run audit logging.
 *
 * `ensureHqFirstRunAuthFile` mints two tokens on the bootstrap path (one
 * browser, one client) and emits one `kind: 'first-run'` audit entry per
 * token into `<dataDir>/auth-audit.jsonl`. These tests pin that contract:
 *
 *   - both entries land, one per scope, with the minted tokenId/label
 *   - capabilities + expiresAt are recorded when present
 *   - the optional `actor` option threads through to both entries
 *   - re-invoking on an existing auth.json does NOT log again
 *   - the raw token string never appears in the audit log
 *
 * @vitest-environment node
 */
import {
  ensureHqFirstRunAuthFile,
  hqAuthAuditPath,
  type HqAuthAuditEntry,
} from '@wrongstack/core';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const HOUR_MS = 60 * 60 * 1000;

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hq-first-run-audit-'));
  tempDirs.push(dir);
  return fn(dir);
}

async function readAuditEntries(dir: string): Promise<HqAuthAuditEntry[]> {
  try {
    const raw = await readFile(hqAuthAuditPath(dir), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HqAuthAuditEntry);
  } catch {
    return [];
  }
}

describe('ensureHqFirstRunAuthFile — first-run audit logging', () => {
  it('emits two first-run entries (one per scope) on the bootstrap path', async () => {
    await withTempDir(async (dir) => {
      const result = await ensureHqFirstRunAuthFile(dir);
      expect(result.created).toBe(true);
      expect(result.browserToken).toBeDefined();
      expect(result.clientToken).toBeDefined();

      const entries = await readAuditEntries(dir);
      const firstRun = entries.filter((e) => e.kind === 'first-run');
      expect(firstRun).toHaveLength(2);

      const scopes = firstRun.map((e) => e.scope).sort();
      expect(scopes).toEqual(['browser', 'client']);
    });
  });

  it('records the minted tokenId and label for each scope', async () => {
    await withTempDir(async (dir) => {
      const result = await ensureHqFirstRunAuthFile(dir);
      const entries = await readAuditEntries(dir);
      const firstRun = entries.filter((e) => e.kind === 'first-run');

      const browser = firstRun.find((e) => e.scope === 'browser');
      const client = firstRun.find((e) => e.scope === 'client');
      expect(browser?.tokenId).toBe(result.browserToken!.id);
      expect(client?.tokenId).toBe(result.clientToken!.id);

      // First-run labels are minted as 'first-run browser' / 'first-run client'.
      expect(browser?.label).toBe('first-run browser');
      expect(client?.label).toBe('first-run client');
    });
  });

  it('records capabilities + expiresAt when the token carries them', async () => {
    await withTempDir(async (dir) => {
      const result = await ensureHqFirstRunAuthFile(dir, { tokenTtlMs: HOUR_MS });
      expect(result.browserToken?.expiresAt).toBeDefined();
      expect(result.clientToken?.expiresAt).toBeDefined();

      const entries = await readAuditEntries(dir);
      const browser = entries.find(
        (e) => e.kind === 'first-run' && e.scope === 'browser',
      );
      const client = entries.find((e) => e.kind === 'first-run' && e.scope === 'client');

      expect(browser?.capabilities).toEqual(['control.enqueue']);
      expect(browser?.expiresAt).toBe(result.browserToken!.expiresAt);
      expect(client?.capabilities).toEqual(['telemetry.publish']);
      expect(client?.expiresAt).toBe(result.clientToken!.expiresAt);
    });
  });

  it('threads the optional actor option into both entries', async () => {
    await withTempDir(async (dir) => {
      await ensureHqFirstRunAuthFile(dir, { actor: 'alice@host' });

      const entries = await readAuditEntries(dir);
      const firstRun = entries.filter((e) => e.kind === 'first-run');
      expect(firstRun).toHaveLength(2);
      for (const entry of firstRun) {
        expect(entry.actor).toBe('alice@host');
      }
    });
  });

  it('omits the actor field when the option is not supplied', async () => {
    await withTempDir(async (dir) => {
      await ensureHqFirstRunAuthFile(dir);

      const entries = await readAuditEntries(dir);
      const firstRun = entries.filter((e) => e.kind === 'first-run');
      expect(firstRun).toHaveLength(2);
      for (const entry of firstRun) {
        expect(entry.actor).toBeUndefined();
      }
    });
  });

  it('does NOT log first-run entries when auth.json already exists', async () => {
    await withTempDir(async (dir) => {
      // First call bootstraps + logs both entries.
      const first = await ensureHqFirstRunAuthFile(dir);
      expect(first.created).toBe(true);
      const afterFirst = await readAuditEntries(dir);
      expect(afterFirst.filter((e) => e.kind === 'first-run')).toHaveLength(2);

      // Second call sees the existing file and returns created:false —
      // no new audit entries.
      const second = await ensureHqFirstRunAuthFile(dir);
      expect(second.created).toBe(false);
      const afterSecond = await readAuditEntries(dir);
      expect(afterSecond.filter((e) => e.kind === 'first-run')).toHaveLength(2);
    });
  });

  it('never records the raw token string — only the tokenId', async () => {
    await withTempDir(async (dir) => {
      const result = await ensureHqFirstRunAuthFile(dir);
      const raw = await readFile(hqAuthAuditPath(dir), 'utf8');

      // The raw token strings must never appear in the audit log.
      expect(raw).not.toContain(result.browserToken!.token);
      expect(raw).not.toContain(result.clientToken!.token);

      // The token ids (UUIDs) must appear — they are safe to log.
      expect(raw).toContain(result.browserToken!.id);
      expect(raw).toContain(result.clientToken!.id);
    });
  });
});
