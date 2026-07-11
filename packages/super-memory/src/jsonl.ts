import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWrite, ensureDir, withFileLock } from '@wrongstack/core/utils';

export interface JsonlCorruptLine {
  filePath: string;
  lineNumber: number;
  raw: string;
  error: string;
}

export async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const line = `${JSON.stringify(value)}\n`;
  await withFileLock(filePath, async () => {
    await fs.appendFile(filePath, line, 'utf8');
  });
}

export async function readJsonl<T>(
  filePath: string,
  onCorrupt?: (line: JsonlCorruptLine) => void | Promise<void>,
): Promise<T[]> {
  return (await readJsonlSnapshot<T>(filePath, onCorrupt)).values;
}

export async function readJsonlSnapshot<T>(
  filePath: string,
  onCorrupt?: (line: JsonlCorruptLine) => void | Promise<void>,
): Promise<{ values: T[]; signature: string }> {
  let raw = '';
  let signature = 'missing';
  try {
    // Readers share the append lock. Without this, a concurrent process can
    // expose a partially appended (but otherwise valid) JSON line and cause a
    // false corruption quarantine.
    ({ raw, signature } = await withFileLock(filePath, async () => {
      const body = await fs.readFile(filePath, 'utf8');
      const stat = await fs.stat(filePath);
      return { raw: body, signature: `${stat.size}:${stat.mtimeMs}` };
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { values: [], signature };
    throw err;
  }

  const values: T[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch (err) {
      await onCorrupt?.({
        filePath,
        lineNumber: i + 1,
        raw: line,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { values, signature };
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
