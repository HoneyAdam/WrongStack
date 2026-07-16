import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PythonAdapter } from '../../src/adapters/python.js';
import { workspaceId } from '../../src/discovery/index.js';
import type { Workspace } from '../../src/types.js';

const PYPROJECT = `[project]
name = "test-py"
dependencies = [
    "django>=5.2,<6.0",
    "requests>=2.32,<3.0",
]
[project.optional-dependencies]
dev = ["pytest>=8.3,<9.0"]
`;

const REQS = `django==5.2.1\nrequests==2.32.3\n`;

function mkWorkspace(files: Record<string, string>): { dir: string; ws: Workspace } {
  const dir = join(tmpdir(), `ts-py-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return { dir, ws: { id: workspaceId('', 'python'), relativeRoot: dir, ecosystem: 'python' as const, manifests: Object.keys(files), lockfiles: [], confidence: 0.9, coverage: 'full' as const } };
}

describe('PythonAdapter', () => {
  it('extracts deps from pyproject.toml', async () => {
    const { dir, ws } = mkWorkspace({ 'pyproject.toml': PYPROJECT });
    try {
      const deps = await new PythonAdapter().inventory(ws, {});
      expect(deps.map(d => d.name)).toContain('django');
      expect(deps.map(d => d.name)).toContain('requests');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('marks optional deps correctly', async () => {
    const { dir, ws } = mkWorkspace({ 'pyproject.toml': PYPROJECT });
    try {
      const deps = await new PythonAdapter().inventory(ws, {});
      expect(deps.find(d => d.name === 'pytest')?.scope).toBe('optional');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('uses requirements.txt pinned versions as locked', async () => {
    const { dir, ws } = mkWorkspace({ 'requirements.txt': REQS });
    try {
      const deps = await new PythonAdapter().inventory(ws, {});
      expect(deps.find(d => d.name === 'django')?.locked).toBe('5.2.1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('has manifest evidence on every dep', async () => {
    const { dir, ws } = mkWorkspace({ 'pyproject.toml': PYPROJECT });
    try {
      const deps = await new PythonAdapter().inventory(ws, {});
      for (const d of deps) expect(d.evidence.some(e => e.kind === 'manifest')).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns [] for empty dir', async () => {
    const { dir, ws } = mkWorkspace({});
    try {
      expect(await new PythonAdapter().inventory(ws, {})).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
