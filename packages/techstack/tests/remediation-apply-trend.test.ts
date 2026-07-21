import { describe, expect, it, vi } from 'vitest';
import { applyPlan, toLanguagePackageInput, type UpgradePlan } from '../src/remediation.js';
import { TrendStore } from '../src/trend.js';
import type { Snapshot } from '../src/types.js';

const plan: UpgradePlan = {
  snapshotId: 's1',
  generatedAt: '2026-01-01T00:00:00Z',
  items: [
    {
      dependencyName: 'pkg',
      ecosystem: 'npm',
      workspaceId: 'ws',
      currentVersion: '1.0.0',
      targetVersion: '2.0.0',
      action: 'upgrade_major',
      severity: 'low',
      rationale: 'upgrade',
      breakingRisk: undefined,
      suggestedCommand: 'npm install pkg@2.0.0',
    },
  ],
  summary: { total: 1, patch: 0, minor: 0, major: 1, replace: 0, remove: 0, investigate: 0 },
  warning: 'review',
};

describe('applyPlan', () => {
  it('is a dry run by default and never invokes the executor', async () => {
    const execute = vi.fn();
    const result = await applyPlan(plan, { execute });
    expect(result).toMatchObject({ dryRun: true, items: [{ status: 'planned' }] });
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes only individually approved structured operations', async () => {
    const execute = vi.fn().mockResolvedValue({ detail: 'ok' });
    const result = await applyPlan(plan, { dryRun: false, approve: () => true, execute });
    expect(execute).toHaveBeenCalledWith({
      ecosystem: 'npm',
      workspaceId: 'ws',
      dependencyName: 'pkg',
      action: 'upgrade_major',
      targetVersion: '2.0.0',
    });
    expect(result.items[0]?.status).toBe('applied');
  });
});

describe('toLanguagePackageInput', () => {
  it('uses ecosystem-specific target syntax and disables lifecycle scripts', () => {
    expect(
      toLanguagePackageInput(
        {
          ecosystem: 'npm',
          workspaceId: 'ws',
          dependencyName: '@scope/pkg',
          action: 'upgrade_minor',
          targetVersion: '2.0.0',
        },
        '.',
      ),
    ).toEqual({
      operation: 'add',
      names: ['@scope/pkg@2.0.0'],
      workspace: '.',
      allowScripts: false,
    });
    expect(
      toLanguagePackageInput({
        ecosystem: 'python',
        workspaceId: 'ws',
        dependencyName: 'requests',
        action: 'upgrade_patch',
        targetVersion: '2.32.0',
      }),
    ).toMatchObject({
      operation: 'add',
      names: ['requests==2.32.0'],
      language: 'python',
      allowScripts: false,
    });
    expect(
      toLanguagePackageInput({
        ecosystem: 'dotnet',
        workspaceId: 'ws',
        dependencyName: 'Serilog',
        action: 'upgrade_minor',
        targetVersion: '4.2.0',
      }),
    ).toMatchObject({
      operation: 'add',
      names: ['Serilog@4.2.0'],
      language: 'csharp',
      allowScripts: false,
    });
  });

  it('maps Go removal to the safe module@none form and rejects manual choices', () => {
    expect(
      toLanguagePackageInput({
        ecosystem: 'go',
        workspaceId: 'ws',
        dependencyName: 'example.com/mod',
        action: 'remove',
      }),
    ).toMatchObject({
      operation: 'add',
      names: ['example.com/mod@none'],
      language: 'go',
    });
    expect(() =>
      toLanguagePackageInput({
        ecosystem: 'npm',
        workspaceId: 'ws',
        dependencyName: 'old',
        action: 'replace',
      }),
    ).toThrow(/manual package choice/);
    expect(() =>
      toLanguagePackageInput({
        ecosystem: 'swift',
        workspaceId: 'ws',
        dependencyName: 'swift-log',
        action: 'upgrade_minor',
        targetVersion: '2.0.0',
      }),
    ).toThrow(/not supported/);
  });
});

function snapshot(
  id: string,
  createdAt: string,
  version: string,
  status: Snapshot['dependencies'][number]['status'],
): Snapshot {
  return {
    id,
    projectId: 'p1',
    targetRoot: '/tmp',
    fingerprint: id,
    createdAt,
    workspaces: [],
    findings: [],
    coverage: 'full',
    adapterVersion: '0.1.0',
    dependencies: [
      {
        id: `d-${id}`,
        workspaceId: 'ws',
        ecosystem: 'npm',
        name: 'pkg',
        sourceType: 'registry',
        direct: true,
        scope: 'runtime',
        locked: version,
        status,
        evidence: [],
      },
    ],
  };
}

describe('TrendStore', () => {
  it('computes version velocity, locked age, and resolved vulnerability half-life', () => {
    const snapshots = [
      snapshot('s1', '2026-01-01T00:00:00Z', '1.0.0', 'vulnerable'),
      snapshot('s2', '2026-01-03T00:00:00Z', '1.0.0', 'vulnerable'),
      snapshot('s3', '2026-01-05T00:00:00Z', '2.0.0', 'current'),
    ];
    const report = new TrendStore({ listSnapshots: () => [...snapshots].reverse() }).analyze('p1');
    expect(report.vulnerabilityHalfLifeMs).toBe(4 * 86_400_000);
    expect(report.dependencies[0]).toMatchObject({
      currentVersion: '2.0.0',
      versionChanges: 1,
      lockedVersionAgeMs: 0,
    });
    expect(report.points).toHaveLength(3);
  });
});
