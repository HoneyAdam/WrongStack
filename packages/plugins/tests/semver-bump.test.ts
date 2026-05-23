import { describe, it, expect, vi, beforeEach } from 'vitest';
import semverBumpPlugin from '../src/semver-bump';

const mockApi = {
  tools: {
    register: vi.fn()
  },
  config: { extensions: {} },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { counter: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
  events: {
    on: vi.fn()
  }
};

describe('semver-bump plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export a Plugin object', () => {
    expect(semverBumpPlugin).toBeDefined();
    expect(semverBumpPlugin.name).toBe('semver-bump');
    expect(semverBumpPlugin.apiVersion).toBe('^0.1.10');
  });

  it('should register three tools in setup', () => {
    semverBumpPlugin.setup(mockApi as any);
    expect(mockApi.tools.register).toHaveBeenCalledTimes(3);
  });

  it('should have semver_bump tool registered', () => {
    semverBumpPlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('semver_bump');
  });

  it('should have semver_current tool registered', () => {
    semverBumpPlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('semver_current');
  });

  it('should have semver_changelog tool registered', () => {
    semverBumpPlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('semver_changelog');
  });

  it('semver_bump should have correct properties', () => {
    semverBumpPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'semver_bump'
    )?.[0];

    expect(tool.description).toBe('Determine the next version bump from conventional commits since the last tag, or force a specific bump. Creates a git tag.');
    expect(tool.permission).toBe('confirm');
    expect(tool.mutating).toBe(true);
  });

  it('semver_current should have correct properties', () => {
    semverBumpPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'semver_current'
    )?.[0];

    expect(tool.description).toBe('Return the current version from package.json and the latest git tag.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(false);
  });

  it('semver_changelog should have correct properties', () => {
    semverBumpPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'semver_changelog'
    )?.[0];

    expect(tool.description).toBe('Generate a changelog (in markdown) between two version tags or from a tag to HEAD.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(false);
  });
});