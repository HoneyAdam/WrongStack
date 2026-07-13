/**
 * test-generator plugin — generates a Vitest test skeleton from a source file
 * using regex-based export detection.
 *
 * Tool registered:
 * - generate_unit_tests : Read a source file and return a test file skeleton.
 *
 * No hooks are registered.
 *
 * Config (`config.extensions['test-generator']`):
 *
 * ```jsonc
 * {
 *   "enabled": true,
 *   "framework": "vitest",
 *   "testSuffix": ".test",
 *   "includeImports": true
 * }
 * ```
 *
 * @public
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from '@wrongstack/core';

const API_VERSION = '^0.1.10';

// ---------------------------------------------------------------------------
// Module-scope state (H1 audit pattern)
// ---------------------------------------------------------------------------

interface TestGeneratorState {
  generateCount: number;
  exportCount: number;
  errorCount: number;
}

const state: TestGeneratorState = {
  generateCount: 0,
  exportCount: 0,
  errorCount: 0,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface TestGeneratorConfig {
  enabled: boolean;
  framework: string;
  testSuffix: string;
  includeImports: boolean;
}

const DEFAULTS: TestGeneratorConfig = {
  enabled: true,
  framework: 'vitest',
  testSuffix: '.test',
  includeImports: true,
};

function readConfig(raw: unknown): TestGeneratorConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r['enabled'] !== false,
    framework: typeof r['framework'] === 'string' ? r['framework'] : DEFAULTS.framework,
    testSuffix: typeof r['testSuffix'] === 'string' ? r['testSuffix'] : DEFAULTS.testSuffix,
    includeImports: r['includeImports'] !== false,
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function withinProject(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return false;
  const root = process.cwd();
  const resolved = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, resolved);
  if (rel === '' || rel === '.') return true;
  if (rel.startsWith('..')) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function relativePath(p: string): string {
  return toPosix(relative(process.cwd(), p));
}

// ---------------------------------------------------------------------------
// Export detection
// ---------------------------------------------------------------------------

export interface DetectedExport {
  name: string;
  kind: 'function' | 'arrow' | 'class' | 'named';
}

function detectExports(content: string): DetectedExport[] {
  const exports: DetectedExport[] = [];
  const seen = new Set<string>();

  const functionRe = /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const arrowRe = /export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
  const classRe = /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const namedRe = /export\s*\{([^}]+)\}/g;

  functionRe.lastIndex = 0;
  for (const match of content.matchAll(functionRe)) {
    if (!seen.has(match[1]!)) {
      seen.add(match[1]!);
      exports.push({ name: match[1]!, kind: 'function' });
    }
  }

  arrowRe.lastIndex = 0;
  for (const match of content.matchAll(arrowRe)) {
    if (!seen.has(match[1]!)) {
      seen.add(match[1]!);
      exports.push({ name: match[1]!, kind: 'arrow' });
    }
  }

  classRe.lastIndex = 0;
  for (const match of content.matchAll(classRe)) {
    if (!seen.has(match[1]!)) {
      seen.add(match[1]!);
      exports.push({ name: match[1]!, kind: 'class' });
    }
  }

  namedRe.lastIndex = 0;
  for (const match of content.matchAll(namedRe)) {
    const names = match[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const raw of names) {
      const parts = raw.split(/\s+as\s+/);
      const name = (parts.length > 1 ? parts[parts.length - 1]! : raw).trim();
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
      if (!seen.has(name)) {
        seen.add(name);
        exports.push({ name, kind: 'named' });
      }
    }
  }

  return exports;
}

function generateTestContent(filePath: string, detected: DetectedExport[], cfg: TestGeneratorConfig): string {
  const sourcePath = relativePath(filePath);
  const importNames = detected.map((e) => e.name).join(', ');
  const lines: string[] = [];

  if (cfg.framework === 'vitest') {
    lines.push(`import { describe, it, expect } from 'vitest';`);
  } else {
    lines.push(`const { describe, it, expect } = require('${cfg.framework}');`);
  }

  if (cfg.includeImports && detected.length > 0) {
    lines.push(`import { ${importNames} } from './${sourcePath.replace(/\.[^.]+$/, '')}';`);
  }

  lines.push('');
  lines.push(`describe('${sourcePath}', () => {`);

  for (const exp of detected) {
    lines.push(`  it('${exp.name} behaves as expected', () => {`);
    lines.push(`    // TODO: replace with a real assertion for ${exp.name}`);
    if (exp.kind === 'class') {
      lines.push(`    const instance = new ${exp.name}();`);
      lines.push(`    expect(instance).toBeDefined();`);
    } else {
      lines.push(`    expect(${exp.name}).toBeDefined();`);
    }
    lines.push(`  });`);
    lines.push('');
  }

  if (detected.length === 0) {
    lines.push(`  it('has no exported symbols to test', () => {`);
    lines.push(`    expect(true).toBe(true);`);
    lines.push(`  });`);
  }

  lines.push(`});`);
  return lines.join('\n');
}

function generateForFile(filePath: string, cfg: TestGeneratorConfig): {
  sourceFile: string;
  testFile: string;
  exports: DetectedExport[];
  content: string;
} {
  const content = readFileSync(filePath, 'utf-8');
  const detected = detectExports(content);
  const sourceName = relativePath(filePath).split('/').pop()!;
  const baseName = sourceName.replace(/\.[^.]+$/, '');
  const testFile = `${baseName}${cfg.testSuffix}.ts`;
  return {
    sourceFile: relativePath(filePath),
    testFile,
    exports: detected,
    content: generateTestContent(filePath, detected, cfg),
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: 'test-generator',
  version: '0.1.0',
  description: 'Generates a test file skeleton from exported functions, classes, and arrow functions',
  apiVersion: API_VERSION,
  capabilities: { tools: true },
  defaultConfig: { ...DEFAULTS },
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true, description: 'Master switch.' },
      framework: {
        type: 'string',
        default: 'vitest',
        description: 'Test framework to target.',
      },
      testSuffix: {
        type: 'string',
        default: '.test',
        description: 'Suffix inserted before the extension of the generated test filename.',
      },
      includeImports: {
        type: 'boolean',
        default: true,
        description: 'Emit import statements for detected exports.',
      },
    },
  },

  setup(api) {
    state.generateCount = 0;
    state.exportCount = 0;
    state.errorCount = 0;

    const cfg = readConfig(api.config.extensions?.['test-generator']);

    // --- generate_unit_tests tool ---
    api.tools.register({
      name: 'generate_unit_tests',
      description:
        'Generate a test skeleton for a source file. Detects exported functions, arrow functions, classes, and named exports. Returns the test content as a string; it does not write to disk.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Source file path (relative to project root).',
          },
        },
        required: ['path'],
      },
      permission: 'auto',
      category: 'Development',
      mutating: false,
      async execute(input: { path?: string }) {
        if (!cfg.enabled) return { ok: false, error: 'test-generator is disabled' };

        const rawPath = input.path;
        if (!rawPath || typeof rawPath !== 'string') {
          return { ok: false, error: 'path is required' };
        }
        if (!withinProject(rawPath)) {
          return { ok: false, error: 'path is outside the project root' };
        }

        const resolved = resolve(process.cwd(), rawPath);
        state.generateCount += 1;
        let result: ReturnType<typeof generateForFile>;
        try {
          result = generateForFile(resolved, cfg);
        } catch (err) {
          state.errorCount += 1;
          return { ok: false, error: String(err) };
        }
        state.exportCount += result.exports.length;

        return {
          ok: true,
          sourceFile: result.sourceFile,
          testFile: result.testFile,
          framework: cfg.framework,
          exports: result.exports,
          content: result.content,
        };
      },
    });

    api.log.info('test-generator plugin loaded', {
      version: '0.1.0',
      framework: cfg.framework,
      testSuffix: cfg.testSuffix,
    });
  },

  teardown(api) {
    const final = {
      generated: state.generateCount,
      exports: state.exportCount,
      errors: state.errorCount,
    };
    state.generateCount = 0;
    state.exportCount = 0;
    state.errorCount = 0;
    api.log.info('test-generator: teardown complete', { final });
  },

  async health() {
    return {
      ok: state.errorCount === 0,
      message: state.errorCount
        ? `test-generator: ${state.errorCount} error(s)`
        : `test-generator: ${state.generateCount} generation(s), ${state.exportCount} export(s)`,
      counters: {
        generated: state.generateCount,
        exports: state.exportCount,
        errors: state.errorCount,
      },
    };
  },
};

export default plugin;
