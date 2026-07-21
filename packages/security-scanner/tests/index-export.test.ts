/**
 * Verify that the package's public API is exported correctly from index.ts.
 * This also provides coverage for the otherwise-0% index.ts and types.ts
 * re-export modules.
 */
import { describe, expect, it } from 'vitest';

describe('package exports', () => {
  it('exports all expected symbols', async () => {
    const mod = await import('../src/index.js');
    expect(mod.TechStackDetector).toBeDefined();
    expect(mod.defaultTechStackDetector).toBeDefined();
    expect(mod.gatherFiles).toBeDefined();
    expect(mod.extractJsonBlock).toBeDefined();
    expect(mod.parseNodeDependencies).toBeDefined();
    expect(mod.PackageAuditRunner).toBeDefined();
    expect(mod.parsePackageAuditOutput).toBeDefined();
    expect(mod.SkillGenerator).toBeDefined();
    expect(mod.defaultSkillGenerator).toBeDefined();
    expect(mod.SecurityScanner).toBeDefined();
    expect(mod.defaultSecurityScanner).toBeDefined();
    expect(mod.ReportGenerator).toBeDefined();
    expect(mod.defaultReportGenerator).toBeDefined();
    expect(mod.GitignoreUpdater).toBeDefined();
    expect(mod.defaultGitignoreUpdater).toBeDefined();
    expect(mod.SecurityScannerOrchestrator).toBeDefined();
    expect(mod.defaultOrchestrator).toBeDefined();
    expect(mod.securitySlashCommand).toBeDefined();
    expect(mod.createSecuritySlashCommand).toBeDefined();
    expect(mod.runRedactionDiagnostic).toBeDefined();
  });
});
