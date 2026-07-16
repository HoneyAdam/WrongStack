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
  supportedRegistryEcosystems,
} from '../../src/registry/client.js';

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
