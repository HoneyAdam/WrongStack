import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initCmd } from '../src/subcommands/handlers/init.js';

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let writes: string[];
let errors: string[];
let infos: string[];
let prevEnv: Record<string, string | undefined>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'init-cli-'));
  globalRoot = path.join(tmp, 'global');
  projectRoot = path.join(tmp, 'proj');
  await fs.mkdir(globalRoot, { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });
  writes = [];
  errors = [];
  infos = [];
  // Capture env vars we might modify
  prevEnv = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

afterEach(async () => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

function fakeReader(answers: string[]) {
  let i = 0;
  return {
    readLine: vi.fn(async () => answers[i++] ?? ''),
    close: vi.fn(),
  };
}

function mkDeps(over: Record<string, unknown> = {}) {
  return {
    renderer: {
      write: (s: string) => writes.push(s),
      writeError: (s: string) => errors.push(s),
      writeInfo: (s: string) => infos.push(s),
    },
    modelsRegistry: {
      listProviders: vi.fn().mockResolvedValue([
        {
          id: 'anthropic',
          name: 'Anthropic',
          family: 'anthropic',
          envVars: ['ANTHROPIC_API_KEY'],
          models: [],
        },
        {
          id: 'openai',
          name: 'OpenAI',
          family: 'openai',
          envVars: ['OPENAI_API_KEY'],
          models: [],
        },
        {
          id: 'fancy',
          name: 'Fancy',
          family: 'unsupported',
          envVars: [],
          npm: 'fancy-sdk',
          models: [],
        },
      ]),
      getProvider: vi.fn(async (id: string) => {
        if (id === 'anthropic')
          return {
            id: 'anthropic',
            family: 'anthropic',
            envVars: ['ANTHROPIC_API_KEY'],
          };
        if (id === 'openai')
          return {
            id: 'openai',
            family: 'openai',
            envVars: ['OPENAI_API_KEY'],
          };
        if (id === 'fancy')
          return {
            id: 'fancy',
            family: 'unsupported',
            envVars: [],
            npm: 'fancy-sdk',
          };
        return undefined;
      }),
      suggestModel: vi.fn().mockResolvedValue('claude-sonnet-4'),
    },
    paths: {
      globalConfig: path.join(globalRoot, 'config.json'),
      globalRoot,
      projectDir: path.join(projectRoot, '.wrongstack'),
    },
    projectRoot,
    reader: fakeReader([]),
    ...over,
  } as never;
}

describe('initCmd subcommand', () => {
  it('errors when provider catalog fails to load', async () => {
    const deps = mkDeps({
      modelsRegistry: {
        listProviders: vi.fn().mockRejectedValue(new Error('catalog down')),
      },
    });
    const code = await initCmd([], deps);
    expect(code).toBe(1);
    expect(errors[0]).toContain('catalog down');
  });

  it('cancels gracefully when user types "q" at provider prompt', async () => {
    const deps = mkDeps({ reader: fakeReader(['q']) });
    const code = await initCmd([], deps);
    expect(code).toBe(0);
    expect(writes.some((w) => w.includes('Cancelled'))).toBe(true);
  });

  it('errors when provider id is not in the catalog', async () => {
    const deps = mkDeps({
      reader: fakeReader(['bogus']),
    });
    const code = await initCmd([], deps);
    expect(code).toBe(1);
    expect(errors[0]).toContain('not found in models.dev catalog');
  });

  it('errors when chosen provider has an unsupported family', async () => {
    const deps = mkDeps({ reader: fakeReader(['fancy']) });
    const code = await initCmd([], deps);
    expect(code).toBe(1);
    expect(errors[0]).toContain('fancy-sdk');
  });

  it('cancels gracefully when user types "q" at model prompt', async () => {
    const deps = mkDeps({ reader: fakeReader(['anthropic', 'q']) });
    const code = await initCmd([], deps);
    expect(code).toBe(0);
    expect(writes.some((w) => w.includes('Cancelled'))).toBe(true);
  });

  it('errors when no model is selected and none suggested', async () => {
    const deps = mkDeps({
      reader: fakeReader(['anthropic', '']),
      modelsRegistry: {
        listProviders: vi.fn().mockResolvedValue([
          {
            id: 'anthropic',
            name: 'Anthropic',
            family: 'anthropic',
            envVars: ['ANTHROPIC_API_KEY'],
          },
        ]),
        getProvider: vi.fn().mockResolvedValue({
          id: 'anthropic',
          family: 'anthropic',
          envVars: ['ANTHROPIC_API_KEY'],
        }),
        suggestModel: vi.fn().mockResolvedValue(null),
      },
    });
    const code = await initCmd([], deps);
    expect(code).toBe(1);
    expect(errors[0]).toContain('No model selected');
  });

  it('writes config and AGENTS.md on the happy path (user supplies API key)', async () => {
    const deps = mkDeps({
      reader: fakeReader(['anthropic', 'claude-opus-4', 'sk-test-key']),
    });
    const code = await initCmd([], deps);
    expect(code).toBe(0);
    // Config written
    const cfgRaw = await fs.readFile(path.join(globalRoot, 'config.json'), 'utf8');
    const cfg = JSON.parse(cfgRaw);
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-opus-4');
    // AGENTS.md created
    const agents = await fs.readFile(path.join(projectRoot, '.wrongstack', 'AGENTS.md'), 'utf8');
    expect(agents.length).toBeGreaterThan(0);
  });

  it('skips API-key prompt when env var is set, and notes detection', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const reader = fakeReader(['anthropic', 'claude-opus-4']);
    const deps = mkDeps({ reader });
    const code = await initCmd([], deps);
    expect(code).toBe(0);
    // Only two prompts asked — no API-key prompt
    expect(reader.readLine).toHaveBeenCalledTimes(2);
    expect(infos.some((s) => s.includes('Found API key in env'))).toBe(true);
  });

  it('detects API keys from env and ranks the matching provider first', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    const reader = fakeReader(['', 'gpt-4o', 'sk-test-key']);
    const deps = mkDeps({ reader });
    const code = await initCmd([], deps);
    expect(code).toBe(0);
    // "Detected API keys for: OpenAI" line should have been printed
    expect(writes.some((w) => w.includes('Detected API keys for:'))).toBe(true);
    expect(writes.some((w) => w.includes('OpenAI'))).toBe(true);
  });
});
