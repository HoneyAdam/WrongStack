import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gradeLocalManifest } from '../src/graders/local-manifest-grader.js';
import type { LocalTaskMeta } from '../src/suites/local-manifest.js';
import type { BenchTask } from '../src/types.js';

let tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

async function makeWorkdir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-local-grader-cov-'));
  tmpDirs.push(dir);
  return dir;
}

function task(meta: LocalTaskMeta, templateDir: string): BenchTask {
  return {
    id: 'local/test',
    suite: 'local',
    prompt: 'test',
    templateDir,
    meta: meta as never as Record<string, unknown>,
  };
}

describe('gradeLocalManifest — assertion type coverage', () => {
  it('passes file_not_exists when the file is absent', async () => {
    const workdir = await makeWorkdir();
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_not_exists', path: 'should-not-exist.txt' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ passed: true });
  });

  it('fails file_not_exists when the file exists', async () => {
    const workdir = await makeWorkdir();
    await fs.writeFile(path.join(workdir, 'exists.txt'), 'content', 'utf8');
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_not_exists', path: 'exists.txt' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('expected file not to exist');
  });

  it('fails file_contains when text is not found', async () => {
    const workdir = await makeWorkdir();
    await fs.writeFile(path.join(workdir, 'report.txt'), 'actual content', 'utf8');
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_contains', path: 'report.txt', text: 'missing text' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('expected report.txt to contain');
  });

  it('passes file_not_contains when text is absent', async () => {
    const workdir = await makeWorkdir();
    await fs.writeFile(path.join(workdir, 'clean.txt'), 'no bad words here', 'utf8');
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_not_contains', path: 'clean.txt', text: 'TODO' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ passed: true });
  });

  it('fails file_not_contains when text is present', async () => {
    const workdir = await makeWorkdir();
    await fs.writeFile(path.join(workdir, 'dirty.txt'), 'TODO: fix this', 'utf8');
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_not_contains', path: 'dirty.txt', text: 'TODO' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('expected dirty.txt not to contain');
  });

  it('reports command error when grader command times out', async () => {
    const workdir = await makeWorkdir();
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          grader: {
            type: 'command',
            command: process.execPath,
            args: ['-e', 'setTimeout(() => {}, 30000)'],
            shell: false,
            timeoutMs: 50,
          },
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('command timed out');
  });

  it('reports truncated grader command output', async () => {
    const workdir = await makeWorkdir();
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          grader: {
            type: 'command',
            command: process.execPath,
            args: ['-e', "process.stdout.write('x'.repeat(5000)); process.exit(0)"],
            shell: false,
            maxBufferBytes: 100,
          },
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('command output exceeded capture limit');
  });

  it('reports absolute assertion path error', async () => {
    const workdir = await makeWorkdir();
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_exists', path: '/absolute/path' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('absolute assertion paths are not allowed');
  });

  it('reports unreadable file for file_contains assertion', async () => {
    const workdir = await makeWorkdir();
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_contains', path: 'nonexistent.txt', text: 'anything' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('cannot read nonexistent.txt');
  });

  it('reports unreadable file for file_not_contains assertion', async () => {
    const workdir = await makeWorkdir();
    const result = await gradeLocalManifest({
      workdir,
      task: task(
        {
          manifestFile: 'bench.local.json',
          rawId: 'test',
          templateHash: 'abc',
          assertions: [{ type: 'file_not_contains', path: 'missing.txt', text: 'nope' }],
        },
        workdir,
      ),
      timeoutMs: 10_000,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('cannot read missing.txt');
  });
});
