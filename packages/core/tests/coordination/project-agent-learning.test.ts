import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConsolidationInstruction,
  buildProjectContextualizedPrompt,
  captureLearnedFromAgentOutputDetailed,
  clearProjectAgentConsolidated,
  createProjectAgent,
  createProjectAgentRoster,
  getProjectAgentLearnStats,
  isConsolidated,
  listProjectAgentLearnedEntries,
  listProjectAgentRoles,
  loadConsolidationMetadata,
  loadProjectAgentConsolidated,
  saveProjectAgentConsolidated,
  updateProjectAgentConfig,
  updateProjectAgentLearned,
  updateProjectAgentLearningPolicy,
  validateProjectAgentConfig,
} from '../../src/coordination/agents/project-agent-identity.js';

describe('project agent self-learning lifecycle', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrongstack-agent-learning-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('captures durable blocks, persists counters, and deduplicates within one result', () => {
    const learning =
      'Use the repository package manager and run the narrow package test before the workspace suite so failures remain attributable.';
    const result = captureLearnedFromAgentOutputDetailed(
      `Done.\n\n## LEARNED\n${learning}\n\n## LEARNED\n${learning}`,
      'executor',
      projectRoot,
    );

    expect(result).toMatchObject({ status: 'captured', captured: 1, skipped: 1 });
    expect(listProjectAgentLearnedEntries('executor', projectRoot)).toHaveLength(1);
    expect(getProjectAgentLearnStats('executor', projectRoot)).toMatchObject({
      entryCount: 1,
      lifetimeCaptureCount: 1,
      lastCaptureSource: 'automatic',
    });
  });

  it('does not consume the automatic capture guard when output has no LEARNED block', () => {
    expect(
      captureLearnedFromAgentOutputDetailed('ordinary task output', 'reviewer', projectRoot),
    ).toMatchObject({ status: 'no_blocks', captured: 0 });

    const result = captureLearnedFromAgentOutputDetailed(
      '## LEARNED\nReview migrations together with their rollback path because schema-only checks miss operational recovery failures.',
      'reviewer',
      projectRoot,
    );
    expect(result.status).toBe('captured');
  });

  it('pauses automatic capture and prompt injection without deleting learned data', () => {
    updateProjectAgentLearned(
      'architect',
      'The project keeps transport contracts in the protocol package and UI mirrors must remain structurally compatible.',
      projectRoot,
      'replace',
    );
    updateProjectAgentLearningPolicy('architect', { enabled: false }, projectRoot);

    const result = captureLearnedFromAgentOutputDetailed(
      '## LEARNED\nKeep architectural boundaries explicit and verify package exports whenever a new cross-package import is introduced.',
      'architect',
      projectRoot,
    );
    expect(result.status).toBe('disabled');
    expect(listProjectAgentLearnedEntries('architect', projectRoot)).toHaveLength(1);
    expect(buildProjectContextualizedPrompt('base prompt', 'architect', projectRoot)).not.toContain(
      'transport contracts',
    );
  });

  it('rejects traversal-shaped role ids before touching the filesystem', () => {
    expect(() =>
      updateProjectAgentLearned('../outside', 'should never be written', projectRoot, 'replace'),
    ).toThrow(/Invalid project agent role/);
    expect(fs.existsSync(path.join(projectRoot, '.wrongstack', 'outside'))).toBe(false);
  });

  it('enforces the per-session cap within a multi-block response', () => {
    const output = [
      'Run focused contract tests before broad suites so failures remain attributable to the changed package.',
      'Preserve user-owned dirty files and inspect overlapping diffs before applying any repository edit.',
      'Validate all filesystem role identifiers before joining them into project customization paths.',
      'Reload durable learned context for every spawn so cached prompts cannot retain stale project guidance.',
      'Record learning counters only after an entry is actually accepted and written successfully to disk.',
    ]
      .map((lesson) => `## LEARNED\n${lesson}`)
      .join('\n\n');

    const result = captureLearnedFromAgentOutputDetailed(output, 'tester', projectRoot);
    expect(result).toMatchObject({ status: 'captured', captured: 3, skipped: 2 });
    expect(listProjectAgentLearnedEntries('tester', projectRoot)).toHaveLength(3);
  });

  it('discovers config-only project agent roles', () => {
    updateProjectAgentConfig('custom-reviewer', { tools: ['read_file'] }, projectRoot);
    expect(listProjectAgentRoles(projectRoot)).toContain('custom-reviewer');
  });

  it('creates a generic-derived role with isolated identity and learning', () => {
    const profile = createProjectAgent(
      {
        name: 'ABC',
        purpose: 'Own X, Y and Z workflows for this project.',
        taskTypes: ['X workflow', 'Y analysis', 'Z verification'],
      },
      projectRoot,
    );
    const roster = createProjectAgentRoster(
      {
        generic: { id: 'generic', role: 'generic', name: 'Generic', prompt: 'GENERIC-BASE' },
      },
      projectRoot,
    );

    expect(profile.role).toBe('abc');
    expect(Object.keys(roster)).toContain('abc');
    expect(roster['abc']).toMatchObject({
      id: 'abc',
      role: 'abc',
      name: 'ABC',
      prompt: 'GENERIC-BASE',
    });

    const lesson =
      'When processing Z verification, compare the generated artifact with the project contract before reporting completion.';
    expect(
      captureLearnedFromAgentOutputDetailed(`## LEARNED\n${lesson}`, 'abc', projectRoot, true),
    ).toMatchObject({ status: 'captured', captured: 1 });
    const prompt = buildProjectContextualizedPrompt('GENERIC-BASE', 'abc', projectRoot);
    expect(prompt).toContain('Own X, Y and Z workflows');
    expect(prompt).toContain(lesson);
    expect(listProjectAgentLearnedEntries('generic', projectRoot)).toHaveLength(0);
  });

  it('clones built-in and custom roster roles while keeping independent identity', () => {
    const first = createProjectAgent(
      {
        name: 'Project Hunter',
        baseRole: 'bug-hunter',
        purpose: 'Find project-specific runtime and integration defects.',
        taskTypes: ['bug investigation', 'regression verification'],
      },
      projectRoot,
    );
    updateProjectAgentConfig('project-hunter', { tools: ['read_file'] }, projectRoot);
    const second = createProjectAgent(
      {
        name: 'Focused Hunter',
        baseRole: 'project-hunter',
        purpose: 'Investigate defects in a narrowly assigned package.',
        taskTypes: ['focused defect investigation'],
      },
      projectRoot,
    );
    const roster = createProjectAgentRoster(
      {
        generic: { name: 'Generic', role: 'generic', prompt: 'GENERIC' },
        'bug-hunter': {
          name: 'Bug Hunter',
          role: 'bug-hunter',
          prompt: 'BUG-HUNTER-PERSONA',
          tools: ['read_file', 'bash'],
          skillNames: ['debugging'],
        },
      },
      projectRoot,
    );

    expect(first.baseRole).toBe('bug-hunter');
    expect(second.baseRole).toBe('project-hunter');
    expect(roster['project-hunter']).toMatchObject({
      role: 'project-hunter',
      prompt: 'BUG-HUNTER-PERSONA',
      tools: ['read_file'],
      skillNames: ['debugging'],
    });
    expect(roster['focused-hunter']).toMatchObject({
      role: 'focused-hunter',
      prompt: 'BUG-HUNTER-PERSONA',
      tools: ['read_file'],
      skillNames: ['debugging'],
    });
    expect(listProjectAgentLearnedEntries('project-hunter', projectRoot)).toHaveLength(0);
    expect(listProjectAgentLearnedEntries('focused-hunter', projectRoot)).toHaveLength(0);
  });

  it('applies live runtime policy while preserving built-in system safety floors', () => {
    updateProjectAgentConfig(
      'executor',
      {
        tools: ['bash'],
        allowedCapabilities: ['shell.execute'],
        budget: { timeoutMs: 1, maxIterations: 1, maxToolCalls: 1, maxTokens: 1 },
        modelPolicy: {
          allowed: [{ provider: 'openai', model: 'gpt-system' }],
          strict: true,
        },
        availability: {
          timezone: 'UTC',
          days: [1],
          start: '09:00',
          end: '10:00',
          mode: 'enforce',
        },
      },
      projectRoot,
    );
    const roster = createProjectAgentRoster(
      {
        executor: {
          name: 'Executor',
          role: 'executor',
          tools: ['read_file'],
          allowedCapabilities: ['fs.read'],
        },
      },
      projectRoot,
    );

    expect(roster['executor']).toMatchObject({
      tools: ['read_file', 'bash'],
      allowedCapabilities: ['fs.read', 'shell.execute'],
      timeoutMs: 300_000,
      maxIterations: 20,
      maxToolCalls: 40,
      maxTokens: 8_192,
      modelPolicy: { strict: false },
      availability: { mode: 'advisory' },
    });
  });

  it('allows generic-derived roles to use strict, narrow runtime policies', () => {
    createProjectAgent(
      { name: 'ABC', purpose: 'Own project release checks.', taskTypes: ['release checks'] },
      projectRoot,
    );
    updateProjectAgentConfig(
      'abc',
      {
        tools: ['read_file'],
        allowedCapabilities: ['fs.read'],
        budget: { maxIterations: 2 },
        cwd: 'packages/core',
        worktree: 'required',
        modelPolicy: {
          allowed: [{ provider: 'openai', model: 'gpt-custom' }],
          strict: true,
        },
        availability: {
          timezone: 'Europe/Kiev',
          days: [1, 2, 3, 4, 5],
          start: '09:00',
          end: '18:00',
          mode: 'enforce',
        },
      },
      projectRoot,
    );
    const roster = createProjectAgentRoster(
      { generic: { name: 'Generic', role: 'generic', tools: ['bash'] } },
      projectRoot,
    );

    expect(roster['abc']).toMatchObject({
      tools: ['read_file'],
      allowedCapabilities: ['fs.read'],
      maxIterations: 2,
      cwd: 'packages/core',
      worktree: 'required',
      modelPolicy: { strict: true },
      availability: { mode: 'enforce' },
    });
  });

  it('rejects escaping workdirs and fallback models outside the allowlist', () => {
    expect(() => validateProjectAgentConfig({ cwd: '../outside' })).toThrow(/assigned checkout/);
    expect(() =>
      validateProjectAgentConfig({
        modelPolicy: {
          allowed: [{ provider: 'openai', model: 'primary' }],
          fallbacks: [{ provider: 'other', model: 'unapproved' }],
        },
      }),
    ).toThrow(/fallback must also appear in allowed/);
  });

  // ── Consolidation lifecycle ──────────────────────────────────────────

  it('saves, loads, and clears consolidated documents with metadata', () => {
    expect(isConsolidated('executor', projectRoot)).toBe(false);
    expect(loadProjectAgentConsolidated('executor', projectRoot)).toBe('');
    expect(loadConsolidationMetadata('executor', projectRoot)).toBeUndefined();

    // Seed some raw entries so metadata can record them
    updateProjectAgentLearned(
      'executor',
      'Always run pnpm typecheck before declaring work complete.',
      projectRoot,
      'replace',
    );

    const content = '# Consolidated knowledge for executor\n\n- Run pnpm typecheck before completion.';
    saveProjectAgentConsolidated('executor', content, projectRoot);

    expect(isConsolidated('executor', projectRoot)).toBe(true);
    expect(loadProjectAgentConsolidated('executor', projectRoot)).toBe(content);

    const meta = loadConsolidationMetadata('executor', projectRoot);
    expect(meta).toBeDefined();
    expect(meta!.sourceEntryCount).toBe(1);
    expect(meta!.consolidatedBytes).toBeGreaterThan(0);
    expect(meta!.trigger).toBe('manual');

    clearProjectAgentConsolidated('executor', projectRoot);
    expect(isConsolidated('executor', projectRoot)).toBe(false);
    expect(loadConsolidationMetadata('executor', projectRoot)).toBeUndefined();
  });

  it('prefers consolidated content over raw learned.md in the contextualized prompt', () => {
    const rawEntry =
      'Raw verbose entry about checking migrations together with their recovery strategy before merging.';
    updateProjectAgentLearned('reviewer', rawEntry, projectRoot, 'replace');
    const consolidated = '## Migrations\n\n- Verify rollback paths for all schema changes.';
    saveProjectAgentConsolidated('reviewer', consolidated, projectRoot);

    const prompt = buildProjectContextualizedPrompt('BASE', 'reviewer', projectRoot);
    expect(prompt).toContain(consolidated);
    expect(prompt).toContain('Consolidated knowledge');
    // The raw verbose entry should NOT be in the prompt (only the consolidated version)
    expect(prompt).not.toContain('recovery strategy');
  });

  it('appends stale raw entries after consolidated content when new captures arrive', () => {
    // Seed and consolidate one entry
    updateProjectAgentLearned(
      'tester',
      'Run focused tests before broad suites.',
      projectRoot,
      'replace',
    );
    saveProjectAgentConsolidated('tester', '# Consolidated\n\n- Run focused tests first.', projectRoot);

    const meta = loadConsolidationMetadata('tester', projectRoot);
    expect(meta!.sourceEntryCount).toBe(1);

    // Capture a new raw entry after consolidation
    updateProjectAgentLearned(
      'tester',
      'Always inspect the git diff before applying edits.',
      projectRoot,
      'append',
    );

    const prompt = buildProjectContextualizedPrompt('BASE', 'tester', projectRoot);
    // Consolidated content is present
    expect(prompt).toContain('Run focused tests first');
    // The new stale entry is appended under the "Recently captured" heading
    expect(prompt).toContain('inspect the git diff');
    expect(prompt).toContain('pending next optimization');
  });

  it('falls back to raw learned.md when no consolidation exists', () => {
    updateProjectAgentLearned(
      'architect',
      'Keep transport contracts in the protocol package.',
      projectRoot,
      'replace',
    );
    const prompt = buildProjectContextualizedPrompt('BASE', 'architect', projectRoot);
    expect(prompt).toContain('transport contracts');
    expect(prompt).toContain('Learned wisdom for this project');
  });

  it('builds a consolidation instruction containing all raw entries', () => {
    updateProjectAgentLearned(
      'bug-hunter',
      'Check for null guards before property access.',
      projectRoot,
      'replace',
    );
    updateProjectAgentLearned(
      'bug-hunter',
      'Verify async error handling in all catch blocks.',
      projectRoot,
      'append',
    );

    const { instruction, rawEntries, hasExistingConsolidation } = buildConsolidationInstruction(
      'bug-hunter',
      projectRoot,
    );

    expect(rawEntries).toHaveLength(2);
    expect(hasExistingConsolidation).toBe(false);
    expect(instruction).toContain('null guards');
    expect(instruction).toContain('async error handling');
    expect(instruction).toContain('No omissions');
  });

  it('tracks consolidation state in getProjectAgentLearnStats', () => {
    updateProjectAgentLearned(
      'executor',
      'Some learned content for testing.',
      projectRoot,
      'replace',
    );
    const statsBefore = getProjectAgentLearnStats('executor', projectRoot);
    expect(statsBefore.isConsolidated).toBe(false);
    expect(statsBefore.consolidation).toBeUndefined();

    saveProjectAgentConsolidated('executor', '# Consolidated content', projectRoot);

    const statsAfter = getProjectAgentLearnStats('executor', projectRoot);
    expect(statsAfter.isConsolidated).toBe(true);
    expect(statsAfter.consolidation).toBeDefined();
    expect(statsAfter.consolidation!.sourceEntryCount).toBe(1);
    expect(statsAfter.consolidation!.consolidatedAt).toBeTruthy();
  });

  it('lists roles that only have consolidated files', () => {
    // Clear any pre-existing executor data from other tests
    saveProjectAgentConsolidated('unique-role', '# Just consolidated', projectRoot);
    const roles = listProjectAgentRoles(projectRoot);
    expect(roles).toContain('unique-role');
  });

  it('rejects invalid consolidation metadata gracefully', () => {
    // Manually write invalid JSON to consolidation.json
    const dir = path.join(projectRoot, '.wrongstack', 'agents', 'executor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'consolidation.json'), '{"broken": true}');

    expect(loadConsolidationMetadata('executor', projectRoot)).toBeUndefined();
  });
});
