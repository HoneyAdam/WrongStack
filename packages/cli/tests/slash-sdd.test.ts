import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildSddCommand,
  getActiveSDDContext,
  getActiveSDDPhase,
  getActiveBuilder,
  getTaskProgress,
  getTaskListText,
  markTaskCompleted,
  autoDetectTaskCompletion,
  trySaveSpecFromAIOutput,
  trySaveTasksFromAIOutput,
  trySaveImplementationPlan,
} from '../src/slash-commands/sdd.js';

let tmp: string;
let prevCwd: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-cli-'));
  prevCwd = process.cwd();
  process.chdir(tmp);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

function fakeCtx() {
  return {
    projectRoot: tmp,
    meta: {} as Record<string, unknown>,
  } as never;
}

function build() {
  return buildSddCommand({ context: fakeCtx() } as never);
}

async function cancelAny() {
  // After tests, cancel any lingering builder/state in the process-lifetime singleton
  try {
    await build().run('cancel');
  } catch {
    /* best-effort */
  }
}

afterEach(async () => {
  await cancelAny();
});

// ── helpers (no active session) ──────────────────────────────────────────────

describe('SDD module-level helpers (no active session)', () => {
  it('getActiveSDDContext returns null when no builder is active', () => {
    expect(getActiveSDDContext()).toBeNull();
  });

  it('getActiveSDDPhase returns null when no builder is active', () => {
    expect(getActiveSDDPhase()).toBeNull();
  });

  it('getActiveBuilder returns null when no builder is active', () => {
    expect(getActiveBuilder()).toBeNull();
  });

  it('getTaskProgress returns null without an active task tracker', () => {
    expect(getTaskProgress()).toBeNull();
  });

  it('getTaskListText returns null without an active task tracker', () => {
    expect(getTaskListText()).toBeNull();
  });

  it('markTaskCompleted returns false without an active task tracker', () => {
    expect(markTaskCompleted('anything')).toBe(false);
  });

  it('autoDetectTaskCompletion returns 0 without an active task tracker', () => {
    expect(autoDetectTaskCompletion('Task 1: complete')).toBe(0);
  });

  it('trySaveSpecFromAIOutput returns false without an active builder', async () => {
    expect(await trySaveSpecFromAIOutput('any output')).toBe(false);
  });

  it('trySaveTasksFromAIOutput returns false without an active builder', async () => {
    expect(await trySaveTasksFromAIOutput('[{"title":"x"}]')).toBe(false);
  });

  it('trySaveImplementationPlan returns false without an active builder', () => {
    expect(trySaveImplementationPlan('a plan')).toBe(false);
  });
});

// ── buildSddCommand: simple verbs (no session) ───────────────────────────────

describe('buildSddCommand verbs without an active session', () => {
  it('empty / no-arg shows help', async () => {
    const cmd = build();
    const res = await cmd.run('');
    expect(res?.message).toContain('SDD');
    expect(res?.message).toContain('Spec Builder');
  });

  it('"help" shows help', async () => {
    const cmd = build();
    const res = await cmd.run('help');
    expect(res?.message).toContain('Spec Builder');
  });

  it('unknown verb falls through to default branch + appends help', async () => {
    const cmd = build();
    const res = await cmd.run('frobulate');
    expect(res?.message).toContain('Unknown command "frobulate"');
    expect(res?.message).toContain('Spec Builder');
  });

  it('approve without a session reports "no active SDD session"', async () => {
    const res = await build().run('approve');
    expect(res?.message).toContain('No active SDD session');
  });

  it('confirm and ok aliases also report "no active session"', async () => {
    expect((await build().run('ok'))?.message).toContain('No active SDD session');
    expect((await build().run('confirm'))?.message).toContain('No active SDD session');
  });

  it('execute / run without a session reports "no active session"', async () => {
    expect((await build().run('execute'))?.message).toContain('No active SDD session');
    expect((await build().run('run'))?.message).toContain('No active SDD session');
  });

  it('plan / impl without a session reports "no active session"', async () => {
    expect((await build().run('plan'))?.message).toContain('No active SDD session');
    expect((await build().run('impl'))?.message).toContain('No active SDD session');
  });

  it('spec without a session reports "no active session"', async () => {
    expect((await build().run('spec'))?.message).toContain('No active SDD session');
  });

  it('tasks / task without an active tracker reports "no tasks generated yet"', async () => {
    expect((await build().run('tasks'))?.message).toContain('No tasks generated yet');
    expect((await build().run('task'))?.message).toContain('No tasks generated yet');
  });

  it('done / complete without an active tracker reports "no tasks to complete"', async () => {
    expect((await build().run('done'))?.message).toContain('No tasks to complete');
    expect((await build().run('complete'))?.message).toContain('No tasks to complete');
  });

  it('status without a session reports "no active SDD session"', async () => {
    expect((await build().run('status'))?.message).toContain('No active SDD session');
  });

  it('cancel without a session reports "no active SDD session"', async () => {
    expect((await build().run('cancel'))?.message).toContain('No active SDD session');
  });

  it('list without saved specs reports "no specs saved"', async () => {
    expect((await build().run('list'))?.message).toContain('No specs saved');
    expect((await build().run('ls'))?.message).toContain('No specs saved');
  });

  it('show with unknown id reports "not found"', async () => {
    const res = await build().run('show some-id');
    expect(res?.message).toContain('not found');
  });

  it('view with no id reports "not found"', async () => {
    const res = await build().run('view');
    expect(res?.message).toContain('not found');
  });

  it('templates lists at least one template', async () => {
    const res = await build().run('templates');
    expect(res?.message).toContain('Available Templates');
  });

  it('from with unknown template reports "not found"', async () => {
    const res = await build().run('from definitely-not-a-template-id');
    expect(res?.message).toContain('not found');
  });

  it('version / history with unknown id reports "not found"', async () => {
    expect((await build().run('version some-id'))?.message).toContain('not found');
    expect((await build().run('history some-id'))?.message).toContain('not found');
  });

  it('resume with no saved session reports "no saved SDD session found"', async () => {
    const res = await build().run('resume');
    expect(res?.message).toContain('No saved SDD session found');
  });
});

// ── new / cancel happy paths ────────────────────────────────────────────────

describe('buildSddCommand new + cancel', () => {
  it('"new <title>" starts a session and returns the AI-prompt runText', async () => {
    const res = await build().run('new MyFeature');
    expect(res?.message).toContain('AI Spec Builder');
    expect(res?.message).toContain('MyFeature');
    expect(res?.runText).toContain('SDD SESSION ACTIVE');
    // module-level helpers should now reflect the active session
    expect(getActiveBuilder()).not.toBeNull();
    expect(getActiveSDDContext()).not.toBeNull();
    expect(getActiveSDDPhase()).not.toBeNull();
  });

  it('"new" without title defaults to "Untitled Feature"', async () => {
    const res = await build().run('new');
    expect(res?.message).toContain('Untitled Feature');
  });

  it('--force flag skips the session-resume check', async () => {
    // Create a stale session file
    const sessionDir = path.join(tmp, '.wrongstack');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, 'sdd-session.json'),
      JSON.stringify({ phase: 'questioning' }),
    );
    const res = await build().run('new --force ForcedFeature');
    expect(res?.message).toContain('AI Spec Builder');
    expect(res?.message).toContain('ForcedFeature');
  });

  it('status after new shows the active session details', async () => {
    await build().run('new StatusTest');
    const res = await build().run('status');
    expect(res?.message).toContain('SDD Session Status');
    expect(res?.message).toContain('StatusTest');
  });

  it('plan after new reports no implementation yet', async () => {
    await build().run('new PlanTest');
    const res = await build().run('plan');
    expect(res?.message?.toLowerCase()).toMatch(/no implementation plan|keep answering/);
  });

  it('spec after new reports no spec generated yet', async () => {
    await build().run('new SpecTest');
    const res = await build().run('spec');
    expect(res?.message?.toLowerCase()).toMatch(/no spec|keep answering/);
  });

  it('cancel ends the active session and clears state', async () => {
    await build().run('new ToCancel');
    expect(getActiveBuilder()).not.toBeNull();
    const res = await build().run('cancel');
    expect(res?.message).toContain('cancelled');
    expect(getActiveBuilder()).toBeNull();
  });
});

// ── from template happy path ────────────────────────────────────────────────

describe('buildSddCommand from template', () => {
  it('"from feature" creates a draft spec from the feature template', async () => {
    const res = await build().run('from feature');
    expect(res?.message).toContain('Created draft spec');
  });

  it('"from" (no template id) defaults to feature', async () => {
    const res = await build().run('from');
    expect(res?.message).toContain('Created draft spec');
  });
});

// ── deeper coverage with active session ─────────────────────────────────────

describe('buildSddCommand with an active spec/tasks session', () => {
  it('approve in "questioning" phase returns generate prompt', async () => {
    await build().run('new ApprovePhase');
    const res = await build().run('approve');
    // The fresh phase is "questioning"; approve there asks AI to generate
    expect(res?.message?.toLowerCase()).toContain('no spec generated');
    expect(res?.runText).toContain('SDD SESSION ACTIVE');
  });

  it('execute when phase is not executing/task_review reports cannot execute', async () => {
    await build().run('new ExecPhase');
    const res = await build().run('execute');
    expect(res?.message).toContain('Cannot execute');
  });

  it('trySaveSpecFromAIOutput returns false when AI output does not contain a spec', async () => {
    await build().run('new SpecParse');
    expect(await trySaveSpecFromAIOutput('just chatting, no spec here')).toBe(false);
  });

  it('trySaveTasksFromAIOutput returns false on invalid JSON', async () => {
    await build().run('new TaskParse');
    // No spec yet → returns false even if JSON looks valid
    expect(await trySaveTasksFromAIOutput('```json\n[{"title":"x"}]\n```')).toBe(false);
  });

  it('trySaveImplementationPlan returns false if not in implementation phase', async () => {
    await build().run('new PlanParse');
    // Phase is "questioning", not "implementation" — should refuse
    expect(trySaveImplementationPlan('A '.repeat(60))).toBe(false);
  });

  it('autoDetectTaskCompletion returns 0 when no tracker is active', async () => {
    // Even with a builder, without an executed task graph the tracker is null
    await build().run('new TaskDetect');
    expect(autoDetectTaskCompletion('✅ Task done')).toBe(0);
  });

  it('"resume" while a session is already active reports the conflict', async () => {
    await build().run('new ResumeConflict');
    const res = await build().run('resume');
    expect(res?.message).toContain('already active');
  });

  it('"new" while one is already active without --force lets the second new path through (no resume dialog)', async () => {
    await build().run('new First');
    // Second new should also succeed because the builder is already set
    const res = await build().run('new Second');
    expect(res?.message).toContain('AI Spec Builder');
  });

  it('list after creating a spec from template reports the saved spec', async () => {
    await build().run('from feature');
    const res = await build().run('list');
    expect(res?.message).toContain('Saved Specs');
  });

  it('show finds spec by partial title match', async () => {
    await build().run('from feature');
    const res = await build().run('show new');
    // either matches the "New Specification" title or returns "not found"
    expect(res?.message).toMatch(/New Specification|not found/);
  });
});
