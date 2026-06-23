import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSyncMock, spawnMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: (...a: unknown[]) => execFileSyncMock(...a),
  spawn: (...a: unknown[]) => spawnMock(...a),
}));

vi.mock('node:fs', async (orig) => ({
  ...(await orig<typeof import('node:fs')>()),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { parseSymbols } from '../src/codebase-index/rs-parser.js';

const parse = (content: string, file = 'lib.rs') => parseSymbols({ file, content, lang: 'rs' });
const find = async (content: string, name: string) =>
  (await parse(content)).symbols.find((s) => s.name === name);

function spawnResult(stdoutText: string, code = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn();
  setTimeout(() => {
    if (stdoutText) proc.stdout.emit('data', Buffer.from(stdoutText));
    proc.emit('close', code);
  }, 0);
  return proc;
}

/** Force the native-parser probe to report "unavailable" so the regex path runs. */
const forceRegex = () =>
  execFileSyncMock.mockImplementation(() => {
    throw new Error('rustc missing');
  });

beforeEach(() => {
  execFileSyncMock.mockReset();
  spawnMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('rs-parser regex fallback', () => {
  it('extracts every Rust declaration kind', async () => {
    forceRegex();
    const content = [
      'fn do_thing(a: i32) {}',
      'struct Point {}',
      'enum Color {}',
      'trait Draw {}',
      'impl Point {}',
      'type Alias = i32;',
      'const MAX: i32 = 1;',
      'static GLOBAL: i32 = 2;',
      'mod utils {}',
    ].join('\n');
    expect((await find(content, 'do_thing'))?.kind).toBe('function');
    expect((await find(content, 'Point'))?.kind).toBe('struct');
    expect((await find(content, 'Color'))?.kind).toBe('enum');
    expect((await find(content, 'Draw'))?.kind).toBe('trait');
    expect((await find(content, 'Alias'))?.kind).toBe('type');
    expect((await find(content, 'MAX'))?.kind).toBe('const');
    expect((await find(content, 'GLOBAL'))?.kind).toBe('static');
    expect((await find(content, 'utils'))?.kind).toBe('mod');
  });

  it('classifies an impl block as kind "impl"', async () => {
    forceRegex();
    // Name distinct from any struct/enum so dedup-by-name doesn't mask the impl.
    expect((await find('impl Renderer {}', 'Renderer'))?.kind).toBe('impl');
  });

  it('deduplicates symbols sharing name + line', async () => {
    forceRegex();
    // Two `fn foo` on the same physical line → one survives after dedup.
    const res = await parse('fn foo() {} fn foo() {}');
    expect(res.symbols.filter((s) => s.name === 'foo')).toHaveLength(1);
  });
});

describe('rs-parser native (syn) path', () => {
  it('returns native symbols when rustc + cargo + syn-parser succeed', async () => {
    execFileSyncMock.mockReturnValue(''); // rustc --version and cargo metadata both ok
    spawnMock.mockReturnValue(
      spawnResult(
        JSON.stringify([
          { name: 'native_fn', kind: 'function', line: 1, col: 0, signature: 'fn native_fn()' },
        ]),
      ),
    );
    const res = await parse('fn native_fn() {}');
    expect(res.symbols).toHaveLength(1);
    expect(res.symbols[0]?.name).toBe('native_fn');
    expect(res.symbols[0]?.lang).toBe('rs');
  });

  it('falls back to regex when cargo metadata is missing', async () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'cargo' && args[0] === 'metadata') throw new Error('no cargo project');
      return '';
    });
    // regex path still extracts the struct
    expect((await find('struct OnlyRegex {}', 'OnlyRegex'))?.kind).toBe('struct');
  });

  it('falls back to regex when the native run exits non-zero', async () => {
    execFileSyncMock.mockReturnValue('');
    spawnMock.mockReturnValue(spawnResult('', 1));
    expect((await find('struct FromRegex {}', 'FromRegex'))?.kind).toBe('struct');
  });

  it('falls back to regex when the native run throws', async () => {
    execFileSyncMock.mockReturnValue('');
    spawnMock.mockImplementation(() => {
      throw new Error('cargo run failed');
    });
    expect((await find('enum E {}', 'E'))?.kind).toBe('enum');
  });
});
