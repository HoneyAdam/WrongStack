import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_SRC = path.resolve(process.cwd(), 'packages/core/src');
const FORBIDDEN_WORKSPACE_IMPORT =
  /(?:from\s+['"]|import\s+['"]|import\s*\(\s*['"])(@wrongstack\/[^'"]+)/g;
const ALLOWED_SELF_IMPORTS = new Set(['@wrongstack/core']);

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('core package boundaries', () => {
  it('does not import higher-level WrongStack packages', async () => {
    const files = await walk(CORE_SRC);
    const violations: string[] = [];

    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(FORBIDDEN_WORKSPACE_IMPORT)) {
        const specifier = match[1];
        if (!specifier || ALLOWED_SELF_IMPORTS.has(specifier)) continue;
        violations.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
