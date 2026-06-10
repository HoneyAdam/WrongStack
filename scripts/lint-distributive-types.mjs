/**
 * Lint rule: flag `Omit<T, K>` and `Pick<T, K>` for manual review.
 *
 * These utility types collapse silently on discriminated unions because
 * `keyof Union` is the *intersection* of all members' keys. There is no
 * reliable way to detect this statically without the type checker, so this
 * script flags every usage. The reviewer decides:
 *
 * - `T` is a single type → fine, resolve
 * - `T` is a discriminated union → must use `DistributiveOmit`/`DistributivePick` from @wrongstack/core
 *
 * This script **never fails the build** — it's a review nudge. The actual
 * gate is `pnpm build` which would catch the real `{}` collapse.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const OMIT_RE = /\bOmit</g;
const PICK_RE = /\bPick</g;
const DISTRIBUTIVE_IMPORT_RE = /\bDistributive(Omit|Pick)\b/;
const SOURCE_EXTS = new Set(['.ts', '.tsx']);

const ROOTS = ['packages', 'apps'];
const IGNORE = new Set(['node_modules', 'dist', 'coverage', '.git']);

async function walk(dir, files) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files; // skip unreadable dirs
  }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, files);
    } else if (SOURCE_EXTS.has(extname(e.name)) && e.name !== 'utility-types.ts') {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  // Collect source files.
  const fileLists = await Promise.all(ROOTS.map((r) => walk(r, [])));
  const files = fileLists.flat();

  const findings = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');

    // If the file imports DistributiveOmit or DistributivePick, skip.
    if (DISTRIBUTIVE_IMPORT_RE.test(content)) continue;

    for (const m of content.matchAll(OMIT_RE)) {
      const line = content.slice(0, m.index).split('\n').length;
      findings.push({ file, line, match: 'Omit<' });
    }
    for (const m of content.matchAll(PICK_RE)) {
      const line = content.slice(0, m.index).split('\n').length;
      findings.push({ file, line, match: 'Pick<' });
    }
  }

  if (findings.length === 0) {
    console.log('✅ No Omit<> / Pick<> usages to review.');
    return;
  }

  console.log(`⚠️  ${findings.length} Omit<> / Pick<> usage(s) found for manual review:\n`);
  for (const f of findings) {
    console.log(`   ${f.file}:${f.line}  ${f.match}`);
  }
  console.log(`
📋 Review checklist:
   - If the first type argument is a SINGLE type (interface, type alias, object
     literal) → fine, resolve.
   - If the first type argument IS or COULD BE a discriminated union →
     replace with DistributiveOmit / DistributivePick from @wrongstack/core.
     See: docs/typescript-style-guide.md#discriminated-unions--utility-types

This check never fails CI — it's an informational review nudge.
`);
}

main();
