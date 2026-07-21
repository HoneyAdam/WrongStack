import { createHash } from 'node:crypto';

function normalizeSnippet(lines) {
  return lines.join(' ').replace(/\s+/gu, ' ').trim();
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function collectSkipDeclarations(source, file) {
  const lines = source.split(/\r?\n/u);
  const declarations = [];
  const aliases = new Set();
  const directPattern = /\b(?:it|test|describe)\.(skip|todo|skipIf|runIf)\b/u;
  const ternaryPattern = /\b(?:it|test|describe)\s*:\s*(?:it|test|describe)\.skip\b/u;
  const contextSkipPattern = /\breturn\s+skip\s*\(/u;
  const aliasPattern = /\bconst\s+([A-Za-z_$][\w$]*)\s*=.*\b(?:it|test|describe)\.skip\b/u;

  const add = (line, kind) => {
    const snippet = normalizeSnippet(lines.slice(line, line + 3));
    declarations.push({ file, kind, fingerprint: fingerprint(`${kind}:${snippet}`) });
  };

  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    const direct = directPattern.exec(text);
    if (direct) add(line, direct[1]);
    if (ternaryPattern.test(text)) add(line, 'conditional-skip');
    if (contextSkipPattern.test(text)) add(line, 'runtime-skip');
    const alias = aliasPattern.exec(text);
    if (alias) aliases.add(alias[1]);
  }

  for (const alias of aliases) {
    const invocationPattern = new RegExp(`\\b${alias.replace(/[$]/gu, '\\$&')}\\s*\\(`, 'u');
    for (let line = 0; line < lines.length; line += 1) {
      if (invocationPattern.test(lines[line])) add(line, 'conditional-suite-alias');
    }
  }

  return declarations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.kind.localeCompare(b.kind) ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}

export function validateSkipBudget(current, baseline) {
  const errors = [];
  const toCounts = (rows) => {
    const counts = new Map();
    for (const row of rows) {
      const key = `${row.file}\0${row.kind}\0${row.fingerprint}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const currentCounts = toCounts(current);
  const baselineCounts = toCounts(baseline.declarations ?? []);

  for (const [key, count] of currentCounts) {
    const allowed = baselineCounts.get(key) ?? 0;
    if (count > allowed) {
      const [file, kind] = key.split('\0');
      errors.push(`${file}: ${count - allowed} new or changed ${kind} declaration(s)`);
    }
  }
  for (const [key, count] of baselineCounts) {
    const remaining = currentCounts.get(key) ?? 0;
    if (remaining < count) {
      const [file, kind] = key.split('\0');
      errors.push(
        `${file}: ${count - remaining} resolved or changed ${kind} declaration(s); tighten the reviewed budget`,
      );
    }
  }
  return errors.sort();
}
