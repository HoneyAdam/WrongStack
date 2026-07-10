import { describe, expect, it } from 'vitest';
import {
  type LanguageRuntime,
  resolveRunnerCommand,
  sanitizeRunnerPath,
} from '../src/runtime/index.js';

const TYPESCRIPT_RUNTIME: LanguageRuntime = {
  id: 'typescript',
  packageManager: 'pnpm',
  executable: 'tsc',
  allowedFlags: new Set(['--noEmit', '--pretty', '--pretty=false', '--incremental', '--watch', '--build']),
  subcommands: ['exec'],
  defaultCommand: 'pnpm exec tsc --noEmit',
};

const VITEST_RUNTIME: LanguageRuntime = {
  id: 'javascript',
  packageManager: 'pnpm',
  executable: 'vitest',
  allowedFlags: new Set(['run', '--run', '--runInBand', '--passWithNoTests']),
  subcommands: ['exec'],
  defaultCommand: 'pnpm exec vitest run',
};

const PYTEST_RUNTIME: LanguageRuntime = {
  id: 'python',
  packageManager: 'pip',
  executable: 'pytest',
  allowedFlags: new Set(['-q', '--quiet', '-x', '--exitfirst', '--maxfail']),
  subcommands: [],
  defaultCommand: 'pytest -q',
};

const CARGO_RUNTIME: LanguageRuntime = {
  id: 'rust',
  packageManager: 'cargo',
  executable: 'test',
  allowedFlags: new Set(['--quiet', '-q', '--release', '--no-run']),
  subcommands: [],
  defaultCommand: 'cargo test',
};

const GOLANG_TEST_RUNTIME: LanguageRuntime = {
  id: 'go',
  packageManager: 'go',
  executable: 'test',
  allowedFlags: new Set(['-v', '-count=1', '-run', '-short']),
  subcommands: [],
  defaultCommand: 'go test',
};

describe('runtime helper', () => {
  describe('sanitizeRunnerPath', () => {
    it('rejects empty, leading-dash, and outside-project paths', () => {
      const projectRoot = process.cwd();
      expect(sanitizeRunnerPath('', { projectRoot })).toBeNull();
      expect(sanitizeRunnerPath('--evil', { projectRoot })).toBeNull();
      expect(sanitizeRunnerPath('/etc/passwd', { projectRoot })).toBeNull();
      expect(sanitizeRunnerPath('../outside.ts', { projectRoot })).toBeNull();
    });
    it('accepts paths inside the project', () => {
      const projectRoot = process.cwd();
      const path = sanitizeRunnerPath('src/foo.test.ts', { projectRoot });
      expect(path).toMatch(/[\\/]src[\\/]foo\.test\.ts$/);
    });
  });

  describe('resolveRunnerCommand — TypeScript tsc', () => {
    it('accepts explicit tsc with allowlisted flags', () => {
      expect(resolveRunnerCommand(TYPESCRIPT_RUNTIME, 'tsc --noEmit --pretty')).toEqual({
        cmd: 'tsc',
        args: ['--noEmit', '--pretty'],
        display: 'tsc --noEmit --pretty',
      });
    });
    it('accepts pnpm exec tsc with allowlisted flags', () => {
      const r = resolveRunnerCommand(TYPESCRIPT_RUNTIME, 'pnpm exec tsc --noEmit');
      expect(r?.cmd).toBe('pnpm');
      expect(r?.args).toEqual(['exec', 'tsc', '--noEmit']);
    });
    it.each([
      'pnpm',
      'npx tsc',
      'tsc --config=evil.json',
      'tsc --eval "evil"',
      'tsc --project=../evil.json',
      'pnpm exec tsc --config=evil.json',
      'pnpm tsc --isolatedModules',
      'pnpm --filter evil tsc',
      'pnpm exec tsc --eval "evil"',
      'node -e "require(\'child_process\').exec(\'calc.exe\')"',
    ])('rejects unsafe TypeScript command %#', (command) => {
      expect(resolveRunnerCommand(TYPESCRIPT_RUNTIME, command)).toBeNull();
    });
  });

  describe('resolveRunnerCommand — Vitest', () => {
    it('accepts pnpm exec vitest run', () => {
      const r = resolveRunnerCommand(VITEST_RUNTIME, 'pnpm exec vitest run');
      expect(r?.cmd).toBe('pnpm');
      expect(r?.args).toEqual(['exec', 'vitest', 'run']);
    });
    it.each([
      'pnpm exec vitest --config=evil.ts',
      'vitest --config=evil.ts',
      'pnpm',
      'pnpm exec malicious-pkg',
      'pnpm exec vitest run --config evil.ts',
    ])('rejects unsafe Vitest command %#', (command) => {
      expect(resolveRunnerCommand(VITEST_RUNTIME, command)).toBeNull();
    });
  });

  describe('resolveRunnerCommand — Python pytest', () => {
    it('accepts bare pytest -q', () => {
      const r = resolveRunnerCommand(PYTEST_RUNTIME, 'pytest -q');
      expect(r?.cmd).toBe('pytest');
      expect(r?.args).toEqual(['-q']);
    });
    it.each([
      'pytest --inject=evil',
      'pytest -e "import os; os.system(\'id\')"',
    ])('rejects unsafe pytest command %#', (command) => {
      expect(resolveRunnerCommand(PYTEST_RUNTIME, command)).toBeNull();
    });
  });

  describe('resolveRunnerCommand — Rust cargo test', () => {
    it('accepts cargo test --release', () => {
      const r = resolveRunnerCommand(CARGO_RUNTIME, 'cargo test --release');
      expect(r?.cmd).toBe('cargo');
      expect(r?.args).toEqual(['test', '--release']);
    });
    it.each(['cargo run --evil', 'cargo build'])('rejects non-test cargo invocations %#', (command) => {
      expect(resolveRunnerCommand(CARGO_RUNTIME, command)).toBeNull();
    });
  });

  describe('resolveRunnerCommand — Go test', () => {
    it('accepts go test -v ./...', () => {
      const r = resolveRunnerCommand(GOLANG_TEST_RUNTIME, 'go test -v ./...');
      expect(r?.cmd).toBe('go');
      expect(r?.args).toEqual(['test', '-v', './...']);
    });
    it.each(['go build ./...', 'go run main.go'])('rejects non-test go invocations %#', (command) => {
      expect(resolveRunnerCommand(GOLANG_TEST_RUNTIME, command)).toBeNull();
    });
  });

  describe('shared invariants', () => {
    it('rejects shell metacharacters in every runtime', () => {
      for (const runtime of [TYPESCRIPT_RUNTIME, VITEST_RUNTIME, PYTEST_RUNTIME, CARGO_RUNTIME]) {
        expect(resolveRunnerCommand(runtime, `${runtime.executable} -q; calc.exe`)).toBeNull();
        expect(resolveRunnerCommand(runtime, `${runtime.executable} -q & echo bad`)).toBeNull();
      }
    });
    it('rejects absolute executable paths outside the project', () => {
      expect(
        resolveRunnerCommand(TYPESCRIPT_RUNTIME, '/usr/bin/tsc --noEmit', { projectRoot: process.cwd() }),
      ).toBeNull();
    });
  });
});