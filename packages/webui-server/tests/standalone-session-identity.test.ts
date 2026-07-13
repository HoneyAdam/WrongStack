import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus, SessionRegistry } from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStandaloneSessionIdentityLifecycle } from '../src/server/standalone-session-identity.js';

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe('standalone session identity lifecycle', () => {
  let root: string;
  let globalRoot: string;
  let sessionsDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-webui-identity-'));
    globalRoot = path.join(root, 'global');
    sessionsDir = path.join(root, 'project-data', 'sessions');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('re-points registry and recovery ownership on session swap, then cleans both', async () => {
    const lifecycle = await createStandaloneSessionIdentityLifecycle({
      config: {} as never,
      events: new EventBus(),
      logger,
      paths: {
        globalRoot,
        projectRoot: root,
        projectSlug: 'project-under-test',
        projectSessions: sessionsDir,
      },
      workingDir: root,
      initialSessionId: '2026-07-12/sess_initial',
      sessionRegistry: new SessionRegistry(globalRoot),
      enableHqTelemetry: false,
    });

    await expect(activeSessionId(sessionsDir)).resolves.toBe('2026-07-12/sess_initial');
    await expect(registrySessionIds(globalRoot)).resolves.toEqual(['2026-07-12/sess_initial']);

    await lifecycle.activate('2026-07-12/sess_resumed');

    await expect(activeSessionId(sessionsDir)).resolves.toBe('2026-07-12/sess_resumed');
    await expect(registrySessionIds(globalRoot)).resolves.toEqual(['2026-07-12/sess_resumed']);

    await lifecycle.stop();
    await expect(fs.stat(path.join(sessionsDir, 'active.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(registrySessionIds(globalRoot)).resolves.toEqual([]);
  });

  it('serializes rapid swaps and leaves only the last identity live', async () => {
    const lifecycle = await createStandaloneSessionIdentityLifecycle({
      config: {} as never,
      events: new EventBus(),
      logger,
      paths: {
        globalRoot,
        projectRoot: root,
        projectSlug: 'project-under-test',
        projectSessions: sessionsDir,
      },
      workingDir: root,
      initialSessionId: '2026-07-12/sess_initial',
      sessionRegistry: new SessionRegistry(globalRoot),
      enableHqTelemetry: false,
    });

    await Promise.all([
      lifecycle.activate('2026-07-12/sess_second'),
      lifecycle.activate('2026-07-12/sess_final'),
    ]);

    await expect(activeSessionId(sessionsDir)).resolves.toBe('2026-07-12/sess_final');
    await expect(registrySessionIds(globalRoot)).resolves.toEqual(['2026-07-12/sess_final']);
    await lifecycle.stop();
  });
});

async function activeSessionId(sessionsDir: string): Promise<string> {
  const value = JSON.parse(await fs.readFile(path.join(sessionsDir, 'active.json'), 'utf8')) as {
    sessionId: string;
  };
  return value.sessionId;
}

async function registrySessionIds(globalRoot: string): Promise<string[]> {
  const raw = await fs.readFile(path.join(globalRoot, 'session-registry.json'), 'utf8');
  return Object.keys(JSON.parse(raw) as Record<string, unknown>).sort();
}
