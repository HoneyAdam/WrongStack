import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectHash,
  projectSlug,
  resolveWstackPaths,
  wstackGlobalRoot,
} from '../../src/utils/wstack-paths.js';

describe('wstack-paths', () => {
  it('projectHash is stable for the same absolute path', () => {
    const a = projectHash('/some/project');
    const b = projectHash('/some/project');
    expect(a).toBe(b);
  });

  it('projectHash differs across paths', () => {
    expect(projectHash('/a')).not.toBe(projectHash('/b'));
  });

  it('projectSlug uses folder basename + short hash', () => {
    const slug = projectSlug('/work/my-project');
    expect(slug).toMatch(/^my-project-[a-f0-9]{6}$/);
  });

  it('projectSlug is stable for the same path', () => {
    expect(projectSlug('/a/b/c')).toBe(projectSlug('/a/b/c'));
  });

  it('projectSlug differs when basenames differ', () => {
    expect(projectSlug('/work/foo')).not.toBe(projectSlug('/work/bar'));
  });

  it('slugify collapses special chars', () => {
    // imported indirectly via projectSlug
    const s = projectSlug('/tmp/My Cool Project!');
    expect(s).toMatch(/^my-cool-project-[a-f0-9]{6}$/);
  });

  it('resolves global + project dirs under user home', () => {
    const paths = resolveWstackPaths({
      userHome: '/home/dev',
      projectRoot: '/work/x',
    });
    expect(paths.globalRoot).toBe(path.join('/home/dev', '.wrongstack'));
    expect(paths.globalSkills).toBe(path.join('/home/dev', '.wrongstack', 'skills'));
    expect(paths.inProjectSkills).toBe(path.join('/work/x', '.wrongstack', 'skills'));
    expect(paths.modelsCache).toContain('cache');
    expect(paths.projectDir).toContain('projects');
    expect(paths.projectDir).toContain(paths.projectSlug);
  });

  it('only AGENTS.md and skills are project-local', () => {
    const paths = resolveWstackPaths({
      userHome: '/home/dev',
      projectRoot: '/work/x',
    });
    const sep = path.sep;
    const projSeg = `${sep}work${sep}x`;
    expect(paths.inProjectAgentsFile).toContain(projSeg);
    expect(paths.inProjectSkills).toContain(projSeg);
    expect(paths.projectSessions).not.toContain(projSeg);
    expect(paths.projectTrust).not.toContain(projSeg);
    expect(paths.projectMemory).not.toContain(projSeg);
  });

  it('keeps AutoPhase state under the per-project dir', () => {
    const paths = resolveWstackPaths({
      userHome: '/home/dev',
      projectRoot: '/work/x',
    });
    expect(paths.projectAutophase).toBe(path.join(paths.projectDir, 'autophase'));
    expect(paths.projectAutophase).toContain(paths.projectSlug);
  });
});

describe('wstackGlobalRoot', () => {
  // wstackGlobalRoot honours the WRONGSTACK_HOME env var so tests and
  // sandboxed runs can redirect ALL global state (~/.wrongstack) away
  // from the real user home. See the function's docstring for the
  // original motivation (~20k orphaned fixture dirs under projects/ in
  // the pre-env-var days).
  const prev = process.env['WRONGSTACK_HOME'];
  const restore = () => {
    if (prev === undefined) delete process.env['WRONGSTACK_HOME'];
    else process.env['WRONGSTACK_HOME'] = prev;
  };

  it('returns WRONGSTACK_HOME when set (absolute path resolved)', () => {
    // Use an absolute path that path.resolve() preserves cross-platform.
    // On Linux/macOS `/tmp/wstack-override-1234` stays as-is; on Windows
    // path.resolve('/foo') prepends the cwd drive, so we use the cwd
    // explicitly to keep the test hermetic.
    const hermeticAbs = path.resolve(os.tmpdir(), 'wstack-override-1234');
    try {
      process.env['WRONGSTACK_HOME'] = hermeticAbs;
      expect(wstackGlobalRoot()).toBe(hermeticAbs);
    } finally {
      restore();
    }
  });

  it('resolves a relative WRONGSTACK_HOME against cwd', () => {
    // path.resolve('/some/cwd', 'rel') → '/some/cwd/rel'. Use a known
    // absolute cwd to keep this cross-platform.
    try {
      process.env['WRONGSTACK_HOME'] = 'rel/.wrongstack';
      const got = wstackGlobalRoot();
      // Should be the absolute resolved form, not the relative literal.
      expect(path.isAbsolute(got)).toBe(true);
      expect(got).toMatch(/rel[/\\].?wrongstack$/);
    } finally {
      restore();
    }
  });

  it('treats a whitespace-only WRONGSTACK_HOME as unset', () => {
    try {
      process.env['WRONGSTACK_HOME'] = '   ';
      // Should fall through to the homedir fallback, NOT to "   ".
      const got = wstackGlobalRoot();
      expect(got).not.toBe('   ');
      expect(got.endsWith('.wrongstack')).toBe(true);
    } finally {
      restore();
    }
  });

  it('falls back to ~/.wrongstack (cross-platform via os.homedir) when unset', () => {
    try {
      delete process.env['WRONGSTACK_HOME'];
      const got = wstackGlobalRoot();
      // On Linux/macOS: <homedir>/.wrongstack. On Windows: also
      // <homedir>/.wrongstack (os.homedir() reads USERPROFILE). The
      // contract is "<homedir>/.wrongstack" — the path module handles
      // the separator.
      expect(got.endsWith(`${path.sep}.wrongstack`)).toBe(true);
    } finally {
      restore();
    }
  });
});
