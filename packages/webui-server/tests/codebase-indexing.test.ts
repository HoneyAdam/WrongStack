import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@wrongstack/core';

const {
  cancelPendingReindexes,
  enqueueReindex,
  isIndexableFile,
  runStartupIndex,
  shutdownCodebaseIndexHost,
} = vi.hoisted(() => ({
  cancelPendingReindexes: vi.fn(),
  enqueueReindex: vi.fn(),
  isIndexableFile: vi.fn((filePath: string) => filePath.endsWith('.ts')),
  runStartupIndex: vi.fn(async () => ({
    filesIndexed: 1,
    symbolsIndexed: 2,
    durationMs: 3,
  })),
  shutdownCodebaseIndexHost: vi.fn(),
}));

vi.mock('@wrongstack/tools', () => ({
  cancelPendingReindexes,
  enqueueReindex,
  isIndexableFile,
  runStartupIndex,
  shutdownCodebaseIndexHost,
}));

describe('WebUI codebase indexing', () => {
  const projectRoot = path.resolve('D:/repo');
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(function child() {
      return this;
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isIndexableFile.mockImplementation((filePath: string) => filePath.endsWith('.ts'));
  });

  it('starts the startup index when enabled', async () => {
    const { setupWebUICodebaseIndexing } = await import('@wrongstack/webui-server');
    const signal = new AbortController().signal;
    setupWebUICodebaseIndexing({
      config: {
        indexing: {
          onSessionStart: true,
          onEdit: false,
          watchExternal: false,
          debounceMs: 123,
          indexTimeoutMs: 456,
        },
      },
      context: { signal, meta: { codebaseIndexDir: 'D:/idx' } } as never,
      projectRoot,
      logger: logger as never,
    });

    expect(runStartupIndex).toHaveBeenCalledWith({
      projectRoot,
      indexDir: 'D:/idx',
      signal,
      timeoutMs: 456,
    });
  });

  it('does nothing when indexing config is absent', async () => {
    const { setupWebUICodebaseIndexing } = await import('@wrongstack/webui-server');
    const controller = setupWebUICodebaseIndexing({
      config: {},
      context: { signal: new AbortController().signal, meta: {} } as never,
      projectRoot,
      logger: logger as never,
    });

    controller.onFileWritten(path.join(projectRoot, 'src/a.ts'));
    controller.dispose();

    expect(runStartupIndex).not.toHaveBeenCalled();
    expect(enqueueReindex).not.toHaveBeenCalled();
    expect(cancelPendingReindexes).not.toHaveBeenCalled();
    expect(shutdownCodebaseIndexHost).not.toHaveBeenCalled();
  });

  it('reindexes WebUI-saved files when onEdit is enabled', async () => {
    const { setupWebUICodebaseIndexing } = await import('@wrongstack/webui-server');
    const controller = setupWebUICodebaseIndexing({
      config: {
        indexing: {
          onSessionStart: false,
          onEdit: true,
          watchExternal: false,
          debounceMs: 250,
          indexTimeoutMs: 999,
        },
      },
      context: { signal: new AbortController().signal, meta: {} } as never,
      projectRoot,
      logger: logger as never,
    });

    const file = path.join(projectRoot, 'src/user.ts');
    controller.onFileWritten(file);
    controller.onFileWritten(path.join(projectRoot, 'README.md'));
    controller.onFileWritten(path.resolve('D:/outside.ts'));

    expect(enqueueReindex).toHaveBeenCalledOnce();
    expect(enqueueReindex).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        files: [file],
        debounceMs: 250,
        timeoutMs: 999,
      }),
    );
  });

  it('emits an attributed filesystem activity for WebUI editor saves', async () => {
    const { setupWebUICodebaseIndexing } = await import('@wrongstack/webui-server');
    const events = new EventBus();
    const received: unknown[] = [];
    events.on('file.activity', (event) => received.push(event));
    const controller = setupWebUICodebaseIndexing({
      config: {},
      context: {
        signal: new AbortController().signal,
        meta: {},
        session: { id: 'session-editor' },
      } as never,
      projectRoot,
      logger: logger as never,
      events,
    });
    const file = path.join(projectRoot, 'src/editor.ts');

    controller.onFileWritten(file);
    controller.dispose();

    expect(received).toEqual([
      expect.objectContaining({
        filePath: file,
        operation: 'write',
        phase: 'completed',
        source: 'editor',
        sessionId: 'session-editor',
        agentId: 'webui-editor',
        agentName: 'WebUI Editor',
      }),
    ]);
  });

  it('cleans up pending reindexes and the index host on dispose', async () => {
    const { setupWebUICodebaseIndexing } = await import('@wrongstack/webui-server');
    const controller = setupWebUICodebaseIndexing({
      config: {
        indexing: {
          onSessionStart: false,
          onEdit: true,
          watchExternal: false,
          debounceMs: 400,
        },
      },
      context: { signal: new AbortController().signal, meta: {} } as never,
      projectRoot,
      logger: logger as never,
    });

    controller.dispose();

    expect(cancelPendingReindexes).toHaveBeenCalledOnce();
    expect(shutdownCodebaseIndexHost).toHaveBeenCalledOnce();
  });
});
