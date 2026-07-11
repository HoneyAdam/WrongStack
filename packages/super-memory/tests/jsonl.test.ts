import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl, readJson, readJsonl, readJsonlSnapshot, writeJson } from '../src/jsonl.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-jsonl-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('appendJsonl', () => {
  it('appends a JSON line to a new file', async () => {
    const file = path.join(tmpDir, 'test.jsonl');
    await appendJsonl(file, { a: 1 });
    const content = await fs.readFile(file, 'utf8');
    expect(content.trim()).toBe('{"a":1}');
  });

  it('appends multiple lines to an existing file', async () => {
    const file = path.join(tmpDir, 'test.jsonl');
    await appendJsonl(file, { a: 1 });
    await appendJsonl(file, { b: 2 });
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});

describe('writeJson', () => {
  it('writes a JSON file', async () => {
    const file = path.join(tmpDir, 'test.json');
    await writeJson(file, { hello: 'world' });
    const content = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(content).toEqual({ hello: 'world' });
  });
});

describe('readJson', () => {
  it('returns undefined for missing file', async () => {
    const result = await readJson(path.join(tmpDir, 'missing.json'));
    expect(result).toBeUndefined();
  });

  it('reads an existing JSON file', async () => {
    const file = path.join(tmpDir, 'test.json');
    await fs.writeFile(file, JSON.stringify({ x: 1 }), 'utf8');
    expect(await readJson<{ x: number }>(file)).toEqual({ x: 1 });
  });

  it('returns undefined for invalid JSON', async () => {
    const file = path.join(tmpDir, 'bad.json');
    await fs.writeFile(file, 'not json', 'utf8');
    expect(await readJson(file)).toBeUndefined();
  });
});

describe('readJsonl', () => {
  it('returns empty array for missing file', async () => {
    expect(await readJsonl(path.join(tmpDir, 'missing.jsonl'))).toEqual([]);
  });

  it('reads valid JSONL lines', async () => {
    const file = path.join(tmpDir, 'test.jsonl');
    await appendJsonl(file, { id: 1 });
    await appendJsonl(file, { id: 2 });
    const values = await readJsonl<{ id: number }>(file);
    expect(values).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('calls onCorrupt for invalid lines', async () => {
    const file = path.join(tmpDir, 'test.jsonl');
    await fs.writeFile(file, '{"good": 1}\n{corrupt\n{"good": 2}\n', 'utf8');
    const corruptLines: Array<{ lineNumber: number }> = [];
    const values = await readJsonl<Record<string, unknown>>(file, (line) => {
      corruptLines.push({ lineNumber: line.lineNumber });
    });
    expect(values).toEqual([{ good: 1 }, { good: 2 }]);
    expect(corruptLines).toHaveLength(1);
    expect(corruptLines[0]?.lineNumber).toBe(2);
  });
});

describe('readJsonlSnapshot', () => {
  it('returns values and signature for existing file', async () => {
    const file = path.join(tmpDir, 'test.jsonl');
    await appendJsonl(file, { n: 42 });
    const snapshot = await readJsonlSnapshot<{ n: number }>(file);
    expect(snapshot.values).toEqual([{ n: 42 }]);
    expect(snapshot.signature).not.toBe('missing');
  });

  it('returns empty values and missing signature for non-existent file', async () => {
    const snapshot = await readJsonlSnapshot(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(snapshot.values).toEqual([]);
    expect(snapshot.signature).toBe('missing');
  });
});
