import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: (...a: unknown[]) => execFileSyncMock(...a),
}));

vi.mock('node:fs', async (orig) => ({
  ...(await orig<typeof import('node:fs')>()),
  mkdirSync: (...a: unknown[]) => mkdirSyncMock(...a),
  writeFileSync: (...a: unknown[]) => writeFileSyncMock(...a),
}));

import { extractRefs } from '../src/codebase-index/refs-extractor.js';

beforeEach(() => {
  execFileSyncMock.mockReset();
  mkdirSyncMock.mockReset();
  writeFileSyncMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('extractRefs language dispatch', () => {
  it('returns [] for TS/JS-family languages (handled by ts-parser)', async () => {
    for (const lang of ['ts', 'tsx', 'js', 'jsx'] as const) {
      expect(await extractRefs({ file: 'a.ts', content: 'x', lang })).toEqual([]);
    }
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('returns [] for unsupported languages', async () => {
    expect(await extractRefs({ file: 'a.json', content: '{}', lang: 'json' })).toEqual([]);
  });
});

describe('extractRefs go', () => {
  it('parses go runner JSON output into Ref[]', async () => {
    execFileSyncMock.mockReturnValue(
      JSON.stringify([{ toName: 'fmt.Println', callType: 'call', line: 3 }]),
    );
    const refs = await extractRefs({ file: 'main.go', content: '', lang: 'go' });
    expect(refs).toEqual([{ fromId: 0, toName: 'fmt.Println', callType: 'call', line: 3 }]);
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('refs.exe'),
      ['main.go'],
      expect.any(Object),
    );
  });

  it('returns [] when the runner emits empty output', async () => {
    execFileSyncMock.mockReturnValue('   ');
    expect(await extractRefs({ file: 'main.go', content: '', lang: 'go' })).toEqual([]);
  });

  it('returns [] when the runner output is not valid JSON', async () => {
    execFileSyncMock.mockReturnValue('not json');
    expect(await extractRefs({ file: 'main.go', content: '', lang: 'go' })).toEqual([]);
  });

  it('returns [] when the runner throws', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('go not installed');
    });
    expect(await extractRefs({ file: 'main.go', content: '', lang: 'go' })).toEqual([]);
  });

  it('caches a failed compilation while retaining the go run fallback', async () => {
    vi.resetModules();
    const { extractRefs: freshExtractRefs } = await import('../src/codebase-index/refs-extractor.js');
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'go' && args[0] === 'build') throw new Error('compiler unavailable');
      return '[]';
    });

    await freshExtractRefs({ file: 'first.go', content: '', lang: 'go' });
    await freshExtractRefs({ file: 'second.go', content: '', lang: 'go' });

    const buildCalls = execFileSyncMock.mock.calls.filter(
      ([command, args]) => command === 'go' && (args as string[])[0] === 'build',
    );
    expect(buildCalls).toHaveLength(1);
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      'go',
      ['run', expect.stringContaining('refs.go'), 'first.go'],
      expect.any(Object),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      3,
      'go',
      ['run', expect.stringContaining('refs.go'), 'second.go'],
      expect.any(Object),
    );
  });

  it('returns [] when Go helper initialization fails', async () => {
    vi.resetModules();
    const { extractRefs: freshExtractRefs } = await import('../src/codebase-index/refs-extractor.js');
    mkdirSyncMock.mockImplementation(() => {
      throw new Error('temp directory unavailable');
    });

    expect(await freshExtractRefs({ file: 'main.go', content: '', lang: 'go' })).toEqual([]);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});

describe('extractRefs python', () => {
  it('parses python runner JSON output into Ref[]', async () => {
    execFileSyncMock.mockReturnValue(
      JSON.stringify([{ toName: 'os.path', callType: 'import', line: 1 }]),
    );
    const refs = await extractRefs({ file: 'a.py', content: '', lang: 'py' });
    expect(refs).toEqual([{ fromId: 0, toName: 'os.path', callType: 'import', line: 1 }]);
  });

  it('returns [] on empty python output', async () => {
    execFileSyncMock.mockReturnValue('');
    expect(await extractRefs({ file: 'a.py', content: '', lang: 'py' })).toEqual([]);
  });

  it('returns [] when the python runner throws', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('python missing');
    });
    expect(await extractRefs({ file: 'a.py', content: '', lang: 'py' })).toEqual([]);
  });

  it('returns [] when Python helper initialization fails', async () => {
    vi.resetModules();
    const { extractRefs: freshExtractRefs } = await import('../src/codebase-index/refs-extractor.js');
    writeFileSyncMock.mockImplementation(() => {
      throw new Error('temp script unavailable');
    });

    expect(await freshExtractRefs({ file: 'a.py', content: '', lang: 'py' })).toEqual([]);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
