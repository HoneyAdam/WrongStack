import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';

// Mock spawnSync so we can feed JSON output to the parsers without requiring
// the actual audit tools to be installed on the machine.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

// Mock existsSync for pip-audit requirements file detection
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

const mockedSpawn = vi.mocked(spawnSync);

function mockResult(stdout: string, status = 0, stderr = ''): void {
  mockedSpawn.mockReturnValue({
    stdout,
    stderr,
    status,
    pid: 1,
    output: [null, stdout, stderr],
    signal: null,
  } as ReturnType<typeof spawnSync>);
}

beforeEach(() => {
  mockedSpawn.mockReset();
});

// ── npm audit ─────────────────────────────────────────────────────────

describe('runNpmAudit', () => {
  it('parses npm audit JSON with vulnerabilities', async () => {
    const { runNpmAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        vulnerabilities: {
          lodash: {
            severity: 'high',
            via: [{ title: 'Prototype Pollution', cve: 'CVE-2019-1', url: 'https://x' }],
            fixAvailable: '4.17.21',
          },
        },
        metadata: { vulnerabilities: 1, totalDependencies: 100 },
      }),
    );
    const result = runNpmAudit('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('lodash');
    expect(result.advisories[0]!.severity).toBe('high');
    expect(result.advisories[0]!.summary).toBe('Prototype Pollution');
    expect(result.advisories[0]!.fixVersion).toBe('4.17.21');
    expect(result.advisories[0]!.id).toBe('CVE-2019-1');
    expect(result.advisories[0]!.aliases).toContain('CVE-2019-1');
    expect(result.evidence.kind).toBe('audit');
  });

  it('skips string-only via entries', async () => {
    const { runNpmAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        vulnerabilities: {
          pkg: { severity: 'low', via: ['some-other-pkg'] },
        },
      }),
    );
    const result = runNpmAudit('/fake');
    expect(result.advisories).toHaveLength(0);
  });

  it('skips numeric source references', async () => {
    const { runNpmAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        vulnerabilities: {
          pkg: { severity: 'low', via: [{ source: 42 }] },
        },
      }),
    );
    const result = runNpmAudit('/fake');
    expect(result.advisories).toHaveLength(0);
  });

  it('handles no vulnerabilities (status 0)', async () => {
    const { runNpmAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(JSON.stringify({ vulnerabilities: {} }));
    const result = runNpmAudit('/fake');
    expect(result.advisories).toHaveLength(0);
  });

  it('handles error exit codes', async () => {
    const { runNpmAudit } = await import('../../src/advisory/native-audit.js');
    mockResult('', 2, 'error');
    const result = runNpmAudit('/fake');
    expect(result.advisories).toHaveLength(0);
    expect(result.evidence.detail).toContain('code 2');
  });

  it('handles malformed JSON', async () => {
    const { runNpmAudit } = await import('../../src/advisory/native-audit.js');
    mockResult('not json', 0);
    const result = runNpmAudit('/fake');
    expect(result.advisories).toHaveLength(0);
    expect(result.evidence.detail).toContain('Failed to parse');
  });
});

// ── pip-audit ─────────────────────────────────────────────────────────

describe('runPipAudit', () => {
  it('parses pip-audit JSON output', async () => {
    const { runPipAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify([
        {
          name: 'requests',
          id: 'GHSA-1',
          severity: 'high',
          description: 'SSRF in requests',
          fix_version: '2.32.0',
        },
      ]),
    );
    const result = runPipAudit('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('requests');
    expect(result.advisories[0]!.severity).toBe('high');
    expect(result.advisories[0]!.fixVersion).toBe('2.32.0');
  });

  it('handles pip-audit error exit', async () => {
    const { runPipAudit } = await import('../../src/advisory/native-audit.js');
    mockResult('', 1, 'pip-audit failed');
    const result = runPipAudit('/fake');
    expect(result.advisories).toHaveLength(0);
    expect(result.evidence.detail).toContain('code 1');
  });
});

// ── cargo audit ───────────────────────────────────────────────────────

describe('runCargoAudit', () => {
  it('parses cargo-audit JSON output', async () => {
    const { runCargoAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        vulnerabilities: {
          list: [
            {
              advisory: {
                id: 'RUSTSEC-1',
                title: 'Use after free',
                cvss: 'CRITICAL/...',
                patched_versions: '>=1.2.0',
              },
              package: { name: 'openssl' },
            },
          ],
        },
      }),
    );
    const result = runCargoAudit('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('openssl');
    expect(result.advisories[0]!.severity).toBe('critical');
    expect(result.advisories[0]!.fixVersion).toBe('>=1.2.0');
  });

  it('handles cargo audit error exit', async () => {
    const { runCargoAudit } = await import('../../src/advisory/native-audit.js');
    mockResult('', 1, 'error');
    const result = runCargoAudit('/fake');
    expect(result.advisories).toHaveLength(0);
    expect(result.evidence.detail).toContain('code 1');
  });
});

// ── govulncheck ───────────────────────────────────────────────────────

describe('runGoVulncheck', () => {
  it('parses govulncheck JSON output', async () => {
    const { runGoVulncheck } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        vulns: [
          {
            id: 'GO-2024-1',
            osv: 'CVE-2024-1',
            module_path: 'golang.org/x/crypto',
            details: 'SSH server vulnerability',
            fixed_version: '0.20.0',
          },
        ],
      }),
    );
    const result = runGoVulncheck('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('golang.org/x/crypto');
    expect(result.advisories[0]!.severity).toBe('high');
    expect(result.advisories[0]!.fixVersion).toBe('0.20.0');
  });

  it('handles status 1 (no vulns)', async () => {
    const { runGoVulncheck } = await import('../../src/advisory/native-audit.js');
    mockResult('', 1);
    const result = runGoVulncheck('/fake');
    expect(result.advisories).toHaveLength(0);
    expect(result.evidence.detail).toContain('no vulnerabilities');
  });
});

// ── composer audit ────────────────────────────────────────────────────

describe('runComposerAudit', () => {
  it('parses composer audit JSON output', async () => {
    const { runComposerAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        advisories: {
          'vendor/pkg': [
            {
              cve: 'CVE-2024-2',
              severity: 'high',
              title: 'SQL Injection',
              link: 'https://example.com/advisory/ABC-123',
            },
          ],
        },
      }),
    );
    const result = runComposerAudit('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('vendor/pkg');
    expect(result.advisories[0]!.severity).toBe('high');
    expect(result.advisories[0]!.fixVersion).toBe('ABC-123');
  });

  it('handles composer audit error exit', async () => {
    const { runComposerAudit } = await import('../../src/advisory/native-audit.js');
    mockResult('', 1, 'error');
    const result = runComposerAudit('/fake');
    expect(result.advisories).toHaveLength(0);
  });
});

// ── dotnet package audit ──────────────────────────────────────────────

describe('runDotnetAudit', () => {
  it('parses flat vulnerabilities shape', async () => {
    const { runDotnetAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        vulnerabilities: [
          {
            advisoryId: 'ADV-1',
            packageName: 'Newtonsoft.Json',
            severity: 'high',
            description: 'DoS vulnerability',
            fixedVersion: '13.0.4',
          },
        ],
      }),
    );
    const result = runDotnetAudit('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('Newtonsoft.Json');
    expect(result.advisories[0]!.severity).toBe('high');
    expect(result.advisories[0]!.fixVersion).toBe('13.0.4');
  });

  it('parses nested packages shape', async () => {
    const { runDotnetAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(
      JSON.stringify({
        packages: {
          'Serilog': [
            { advisoryId: 'ADV-2', severity: 'medium', title: 'Info leak' },
          ],
        },
      }),
    );
    const result = runDotnetAudit('/fake');
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe('Serilog');
    expect(result.advisories[0]!.severity).toBe('medium');
  });

  it('handles dotnet audit error exit', async () => {
    const { runDotnetAudit } = await import('../../src/advisory/native-audit.js');
    mockResult('', 1, 'error');
    const result = runDotnetAudit('/fake');
    expect(result.advisories).toHaveLength(0);
  });
});

// ── runNativeAudit dispatch ───────────────────────────────────────────

describe('runNativeAudit dispatch', () => {
  it('dispatches to the correct tool for each ecosystem', async () => {
    const { runNativeAudit } = await import('../../src/advisory/native-audit.js');
    mockResult(JSON.stringify({ vulnerabilities: {} }));
    runNativeAudit('npm', '/fake');
    expect(mockedSpawn).toHaveBeenCalledWith('npm', ['audit', '--json'], expect.anything());

    mockedSpawn.mockClear();
    runNativeAudit('python', '/fake');
    expect(mockedSpawn).toHaveBeenCalledWith('pip-audit', expect.arrayContaining(['audit']), expect.anything());

    mockedSpawn.mockClear();
    runNativeAudit('rust', '/fake');
    expect(mockedSpawn).toHaveBeenCalledWith('cargo', expect.arrayContaining(['audit']), expect.anything());

    mockedSpawn.mockClear();
    runNativeAudit('go', '/fake');
    expect(mockedSpawn).toHaveBeenCalledWith('govulncheck', expect.anything(), expect.anything());

    mockedSpawn.mockClear();
    runNativeAudit('php', '/fake');
    expect(mockedSpawn).toHaveBeenCalledWith('composer', expect.anything(), expect.anything());

    mockedSpawn.mockClear();
    runNativeAudit('dotnet', '/fake');
    expect(mockedSpawn).toHaveBeenCalledWith('dotnet', expect.anything(), expect.anything());
  });

  it('returns an empty result for unsupported ecosystems', async () => {
    const { runNativeAudit } = await import('../../src/advisory/native-audit.js');
    const result = runNativeAudit('dart' as never, '/fake');
    expect(result.advisories).toEqual([]);
    expect(result.evidence.detail).toContain('No native audit tool');
  });
});

// ── isNativeAuditAvailable ────────────────────────────────────────────

describe('isNativeAuditAvailable', () => {
  it('returns true when the tool exits 0', async () => {
    const { isNativeAuditAvailable } = await import('../../src/advisory/native-audit.js');
    mockResult('1.0.0', 0);
    expect(isNativeAuditAvailable('npm')).toBe(true);
  });

  it('returns false when the tool is not installed', async () => {
    const { isNativeAuditAvailable } = await import('../../src/advisory/native-audit.js');
    mockResult('', 127);
    expect(isNativeAuditAvailable('python')).toBe(false);
  });
});
