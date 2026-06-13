import * as fs from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import {
  handleProjectsAdd,
  handleProjectsList,
  handleProjectsSelect,
} from '../../src/webui-server/ws-handlers/index.js';
import type {
  ProjectSwitchContext,
  ProjectsContext,
} from '../../src/webui-server/ws-handlers/projects.js';

/**
 * PR 5l of Issue #30: projects ws-handler unit tests.
 *
 * Mocks node:fs/promises, @wrongstack/core (slug/dir helpers),
 * @wrongstack/core/storage (DefaultSessionStore) and the project-utils
 * manifest module so the handlers run without touching disk.
 */

const FAKE_WS = {} as WebSocket;

const manifestState: {
  projects: Array<{ name: string; root: string; slug: string }>;
} = { projects: [] };
const loadManifest = vi.fn(async () => manifestState);
const saveManifest = vi.fn(async () => undefined);
const ensureProjectDataDir = vi.fn(async () => undefined);

vi.mock('../../src/slash-commands/project-utils.js', () => ({
  loadManifest: (...a: unknown[]) => loadManifest(...(a as [])),
  saveManifest: (...a: unknown[]) => saveManifest(...(a as [])),
  ensureProjectDataDir: (...a: unknown[]) => ensureProjectDataDir(...(a as [])),
}));

const createWriter = vi.fn();
vi.mock('@wrongstack/core', async () => {
  const actual = await vi.importActual<typeof import('@wrongstack/core')>('@wrongstack/core');
  return {
    ...actual,
    projectSlug: (root: string) => `slug-${root}`,
    resolveProjectDir: (root: string) => `/data/${root}`,
    wstackGlobalRoot: () => '/home/.wrongstack',
  };
});
vi.mock('@wrongstack/core/storage', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be `new`-constructable
  DefaultSessionStore: vi.fn(function () {
    return { create: createWriter };
  }),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, readFile: vi.fn(), stat: vi.fn(), mkdir: vi.fn() };
});

const lastOf = (msgs: WsServerMessage[], type: string) =>
  msgs.filter((m) => m.type === type).at(-1);

function listCtx(over: Partial<ProjectsContext> = {}): {
  ctx: ProjectsContext;
  sent: WsServerMessage[];
} {
  const sent: WsServerMessage[] = [];
  const ctx: ProjectsContext = {
    send: (_ws, m) => sent.push(m),
    broadcast: () => {},
    log: () => {},
    globalConfigPath: '/home/.wrongstack/config.json',
    ...over,
  };
  return { ctx, sent };
}

beforeEach(() => {
  vi.clearAllMocks();
  manifestState.projects = [];
});

describe('handleProjectsList', () => {
  it('returns the manifest projects when the file exists', async () => {
    const { ctx, sent } = listCtx();
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ projects: [{ name: 'A', root: '/a', slug: 's' }] }),
    );
    await handleProjectsList(ctx, FAKE_WS);
    const payload = lastOf(sent, 'projects.list')?.payload as { projects: unknown[] };
    expect(payload.projects).toHaveLength(1);
  });

  it('returns an empty list when the manifest is missing', async () => {
    const { ctx, sent } = listCtx();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    await handleProjectsList(ctx, FAKE_WS);
    const payload = lastOf(sent, 'projects.list')?.payload as { projects: unknown[] };
    expect(payload.projects).toEqual([]);
  });
});

describe('handleProjectsAdd', () => {
  it('registers a new directory and persists the manifest', async () => {
    const { ctx, sent } = listCtx();
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    await handleProjectsAdd(ctx, FAKE_WS, { root: '/new/project', name: 'New' });
    expect(saveManifest).toHaveBeenCalled();
    expect(ensureProjectDataDir).toHaveBeenCalled();
    const payload = lastOf(sent, 'projects.added')?.payload as { name: string; message: string };
    expect(payload.name).toBe('New');
    expect(payload.message).toContain('Registered');
  });

  it('does not re-register an existing project', async () => {
    const { ctx, sent } = listCtx();
    manifestState.projects = [{ name: 'Exists', root: '/new/project', slug: 's' }];
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    await handleProjectsAdd(ctx, FAKE_WS, { root: '/new/project' });
    expect(saveManifest).not.toHaveBeenCalled();
    const payload = lastOf(sent, 'projects.added')?.payload as { message: string };
    expect(payload.message).toContain('Already registered');
  });

  it('reports an error when the path is not a directory', async () => {
    const { ctx, sent } = listCtx();
    vi.mocked(fs.stat).mockResolvedValue(null as never);
    await handleProjectsAdd(ctx, FAKE_WS, { root: '/missing' });
    const payload = lastOf(sent, 'projects.added')?.payload as { slug: string; message: string };
    expect(payload.slug).toBe('');
    expect(payload.message).toContain('Not a directory');
  });
});

describe('handleProjectsSelect', () => {
  function switchCtx(): {
    ctx: ProjectSwitchContext;
    sent: WsServerMessage[];
    bc: WsServerMessage[];
    spies: Record<string, ReturnType<typeof vi.fn>>;
  } {
    const sent: WsServerMessage[] = [];
    const bc: WsServerMessage[] = [];
    const spies = {
      setProjectRoot: vi.fn(),
      setSessionStore: vi.fn(),
      abortActiveRun: vi.fn(),
      onSessionSwapped: vi.fn(),
      rebuildSystemPrompt: vi.fn(async () => {}),
      buildSessionStart: vi.fn(async () => ({ ok: true })),
      replaceMessages: vi.fn(),
      replaceTodos: vi.fn(),
    };
    const agentCtx = {
      session: { id: 'old-sess', append: vi.fn(async () => {}), close: vi.fn(async () => {}) },
      tokenCounter: { total: () => ({ input: 0, output: 0 }), reset: vi.fn() },
      cwd: '/old',
      projectRoot: '/old',
      model: 'm',
      provider: { id: 'p' },
      state: { replaceMessages: spies.replaceMessages, replaceTodos: spies.replaceTodos },
      readFiles: { clear: vi.fn() },
      fileMtimes: { clear: vi.fn() },
    } as unknown as ProjectSwitchContext['agentCtx'];
    const ctx: ProjectSwitchContext = {
      send: (_ws, m) => sent.push(m),
      broadcast: (m) => bc.push(m),
      log: () => {},
      globalConfigPath: '/home/.wrongstack/config.json',
      agentCtx,
      startupSessionId: 'startup',
      setProjectRoot: spies.setProjectRoot,
      setSessionStore: spies.setSessionStore,
      abortActiveRun: spies.abortActiveRun,
      onSessionSwapped: spies.onSessionSwapped,
      rebuildSystemPrompt: spies.rebuildSystemPrompt,
      buildSessionStart: spies.buildSessionStart,
    };
    return { ctx, sent, bc, spies };
  }

  it('rejects switching to a non-directory', async () => {
    const { ctx, sent, spies } = switchCtx();
    vi.mocked(fs.stat).mockResolvedValue(null as never);
    await handleProjectsSelect(ctx, FAKE_WS, { root: '/missing' });
    const payload = lastOf(sent, 'projects.selected')?.payload as { message: string };
    expect(payload.message).toContain('not a directory');
    expect(spies.setProjectRoot).not.toHaveBeenCalled();
  });

  it('re-roots, swaps the session, and broadcasts on a valid switch', async () => {
    const { ctx, sent, bc, spies } = switchCtx();
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as never);
    createWriter.mockResolvedValue({ id: 'new-sess' });
    await handleProjectsSelect(ctx, FAKE_WS, { root: '/new/proj', name: 'Proj' });

    expect(spies.abortActiveRun).toHaveBeenCalledWith(FAKE_WS);
    expect(spies.setProjectRoot).toHaveBeenCalledWith(expect.stringContaining('proj'));
    expect(spies.rebuildSystemPrompt).toHaveBeenCalled();
    expect(spies.setSessionStore).toHaveBeenCalled();
    expect(spies.onSessionSwapped).toHaveBeenCalledWith('new-sess');
    expect(spies.replaceMessages).toHaveBeenCalledWith([]);
    expect(saveManifest).toHaveBeenCalled();
    expect(lastOf(sent, 'projects.selected')?.payload).toMatchObject({ name: 'Proj' });
    expect(lastOf(bc, 'session.start')).toBeDefined();
  });
});
