/**
 * TechStack — Registry client tests.
 *
 * Tests the cache, concurrency limiter, and ecosystem-specific URL builders.
 * Network calls are NOT exercised in unit tests — only the cache/bypass logic
 * and error handling are tested.
 *
 * @see packages/techstack/src/registry/client.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearRegistryCache,
  parseNpmPackument,
  supportedRegistryEcosystems,
} from '../../src/registry/client.js';

// ── npm packument parsing ──────────────────────────────────────────────────

describe('parseNpmPackument', () => {
  const packument = (
    latest: string,
    versions: Record<string, Record<string, unknown>>,
    extra: Record<string, unknown> = {},
  ) => ({ 'dist-tags': { latest }, versions, ...extra });

  it('reads latestStable from dist-tags.latest', () => {
    const entry = parseNpmPackument(packument('2.5.4', { '2.5.4': {} }), 'biome');
    expect(entry.latestStable).toBe('2.5.4');
  });

  it('marks a package deprecated when its latest version is deprecated', () => {
    const entry = parseNpmPackument(
      packument('1.0.0', { '1.0.0': { deprecated: 'use something else' } }),
      'dead-pkg',
    );
    expect(entry.deprecated).toBe(true);
  });

  // The rule that broke it: "any version in history is deprecated" flags every
  // mature package, because they all eventually deprecate an old release.
  it('does not mark a package deprecated because an OLD version was', () => {
    const entry = parseNpmPackument(
      packument('4.1.10', {
        '0.0.1': { deprecated: 'early beta, do not use' },
        '1.0.0-beta.1': { deprecated: 'superseded' },
        '4.1.10': {},
      }),
      'vitest',
    );
    expect(entry.deprecated).toBeUndefined();
  });

  it('leaves deprecated undefined for a healthy package', () => {
    const entry = parseNpmPackument(packument('1.0.0', { '1.0.0': {} }), 'healthy');
    expect(entry.deprecated).toBeUndefined();
  });

  it('never reports yanked — npm has no such field', () => {
    const entry = parseNpmPackument(packument('1.0.0', { '1.0.0': {} }), 'pkg');
    expect(entry.yanked).toBeUndefined();
  });

  it('records the registry URL as evidence source', () => {
    const entry = parseNpmPackument(packument('1.0.0', { '1.0.0': {} }), 'react');
    expect(entry.source).toBe('https://registry.npmjs.org/react');
  });

  it('survives a packument with no versions map', () => {
    const entry = parseNpmPackument({ 'dist-tags': { latest: '1.0.0' } }, 'sparse');
    expect(entry.latestStable).toBe('1.0.0');
    expect(entry.deprecated).toBeUndefined();
  });
});

describe('supportedRegistryEcosystems', () => {
  it('returns expected ecosystem IDs', () => {
    const ecosystems = supportedRegistryEcosystems();
    expect(ecosystems).toContain('npm');
    expect(ecosystems).toContain('python');
    expect(ecosystems).toContain('cargo');
    expect(ecosystems).toContain('golang');
    expect(ecosystems).toContain('nuget');
    expect(ecosystems).toContain('composer');
    expect(ecosystems).toContain('pub');
  });
});

describe('clearRegistryCache', () => {
  beforeEach(() => {
    clearRegistryCache();
  });

  it('clears without error when cache is empty', () => {
    expect(() => clearRegistryCache()).not.toThrow();
  });

  it('clears without error when called multiple times', () => {
    clearRegistryCache();
    clearRegistryCache();
    expect(() => clearRegistryCache()).not.toThrow();
  });
});
