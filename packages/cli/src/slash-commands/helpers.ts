import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Context } from '@wrongstack/core';
import { color } from '@wrongstack/core';

export interface ProjectFacts {
  build?: string;
  test?: string;
  lint?: string;
  run?: string;
  hints: string[];
}

export async function detectProjectFacts(root: string): Promise<ProjectFacts> {
  const facts: ProjectFacts = { hints: [] };
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      packageManager?: string;
    };
    const scripts = pkg.scripts ?? {};
    const pm = (pkg.packageManager ?? 'npm').split('@')[0] ?? 'npm';
    if (scripts['build']) facts.build = `${pm} run build`;
    if (scripts['test']) facts.test = `${pm} test`;
    if (scripts['lint']) facts.lint = `${pm} run lint`;
    if (scripts['dev'] ?? scripts['start'])
      facts.run = `${pm} run ${scripts['dev'] ? 'dev' : 'start'}`;
    facts.hints.push('package.json scripts');
  } catch {
    /* not node */
  }
  try {
    await fs.access(path.join(root, 'pyproject.toml'));
    facts.test ??= 'pytest';
    facts.lint ??= 'ruff check .';
    facts.hints.push('pyproject.toml');
  } catch {
    /* not python */
  }
  try {
    await fs.access(path.join(root, 'go.mod'));
    facts.build ??= 'go build ./...';
    facts.test ??= 'go test ./...';
    facts.hints.push('go.mod');
  } catch {
    /* not go */
  }
  try {
    await fs.access(path.join(root, 'Cargo.toml'));
    facts.build ??= 'cargo build';
    facts.test ??= 'cargo test';
    facts.hints.push('Cargo.toml');
  } catch {
    /* not rust */
  }
  try {
    await fs.access(path.join(root, 'Makefile'));
    facts.build ??= 'make';
    facts.test ??= 'make test';
    facts.hints.push('Makefile');
  } catch {
    /* no make */
  }
  return facts;
}

export function renderAgentsTemplate(f: ProjectFacts): string {
  const cmd = (s?: string) => (s ? `\`${s}\`` : '_TODO_');
  return `# AGENTS.md

Project notes for WrongStack. Committed to the repo so every contributor
(human or agent) starts with the same context. Edit freely.

## What this project is

_One paragraph: what does this codebase do, who runs it, what's the
deployment target?_

## How to work on it

- **Build:** ${cmd(f.build)}
- **Test:** ${cmd(f.test)}
- **Lint:** ${cmd(f.lint)}
- **Run locally:** ${cmd(f.run)}

## Conventions

_What style choices matter here? Filenames, module layout, naming, error
handling, log format. Anything a stranger would get wrong._

## Domain knowledge

_Acronyms, business rules, foot-guns, "this looks weird but it's
intentional because…"._

## Pointers

_Where to look for: routing, database migrations, feature flags,
on-call runbooks, dashboards._
`;
}

export function countTurnPairs(messages: Context['messages']): number {
  let count = 0;
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') count++;
  }
  return Math.floor(count / 2);
}

export function countToolUses(messages: Context['messages']): number {
  let count = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) count += m.content.filter((b) => b.type === 'tool_use').length;
  }
  return count;
}

export function countToolResults(messages: Context['messages']): number {
  let count = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) count += m.content.filter((b) => b.type === 'tool_result').length;
  }
  return count;
}

export function estimateTokens(messages: Context['messages']): number {
  let total = 0;
  for (const m of messages) {
    const content = m.content;
    if (typeof content === 'string') {
      total += Math.ceil(content.length / 4);
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text') total += Math.ceil(b.text.length / 4);
        else if (b.type === 'tool_use' || b.type === 'tool_result')
          total += Math.ceil(JSON.stringify(b).length / 4);
      }
    }
  }
  return total;
}

export function statusIcon(status: string): string {
  if (status === 'healthy') return color.green('●');
  if (status === 'degraded') return color.yellow('●');
  return color.red('●');
}
