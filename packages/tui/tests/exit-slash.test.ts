import { describe, expect, it, vi } from 'vitest';
import { createExitSlashCommand } from '../src/exit-slash.js';

function makeOpts(
  overrides: Partial<{
    leaderActive: boolean;
    subagentCount: number;
    confirmResult: boolean;
  }> = {},
) {
  const leaderActive = overrides.leaderActive ?? false;
  const subagentCount = overrides.subagentCount ?? 0;
  const confirmResult = overrides.confirmResult ?? true;
  const confirmExit = vi.fn(async () => confirmResult);
  return {
    opts: {
      isLeaderActive: () => leaderActive,
      countRunningSubagents: () => subagentCount,
      confirmExit,
    },
    confirmExit,
  };
}

describe('createExitSlashCommand', () => {
  it('exposes name "exit" with the kanban-card description', () => {
    const { opts } = makeOpts();
    const cmd = createExitSlashCommand(opts);
    expect(cmd.name).toBe('exit');
    expect(cmd.aliases).toEqual(['quit', 'q']);
    expect(cmd.description).toContain('Exit the TUI');
    expect(cmd.description).toContain('confirmation');
  });

  // (a) inactive short-circuit — handled by `confirmExit` itself, which
  // resolves `true` synchronously when no work is active (see JSDoc on
  // `CreateExitSlashCommandOptions.confirmExit`). The handler always calls
  // it, so the "no work active" path is verified by asserting the info
  // payload is forwarded verbatim and the command exits.
  it('forwards the {leaderActive, subagentCount} info to confirmExit and exits when leader is idle and there are no subagents', async () => {
    const { opts, confirmExit } = makeOpts({
      leaderActive: false,
      subagentCount: 0,
      confirmResult: true,
    });
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('');
    expect(confirmExit).toHaveBeenCalledTimes(1);
    expect(confirmExit).toHaveBeenCalledWith({ leaderActive: false, subagentCount: 0 });
    expect(res).toEqual({ exit: true, message: 'Exiting…' });
  });

  it('reports detached processes that will be preserved on exit', async () => {
    const { opts, confirmExit } = makeOpts();
    const cmd = createExitSlashCommand({
      ...opts,
      countBackgroundProcesses: () => 2,
    });
    const res = await cmd.run('');
    expect(confirmExit).toHaveBeenCalledWith({
      leaderActive: false,
      subagentCount: 0,
      backgroundCount: 2,
    });
    expect(res).toEqual({
      exit: true,
      message: 'Exiting… Preserving 2 background processes.',
    });
  });

  // (b) active path — confirm true
  it('awaits the host exit lifecycle before returning its exit result', async () => {
    const { opts, confirmExit } = makeOpts({
      leaderActive: true,
      subagentCount: 2,
      confirmResult: true,
    });
    let releaseLifecycle!: () => void;
    const lifecycleGate = new Promise<void>((resolve) => {
      releaseLifecycle = resolve;
    });
    const ctx = {} as never;
    const runExitLifecycle = vi.fn(async () => {
      await lifecycleGate;
      return { exit: true, message: 'host cleanup complete' };
    });
    const cmd = createExitSlashCommand({ ...opts, runExitLifecycle });
    let settled = false;
    const pending = cmd.run('', ctx).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(confirmExit).toHaveBeenCalledTimes(1);
    expect(confirmExit).toHaveBeenCalledWith({ leaderActive: true, subagentCount: 2 });
    expect(runExitLifecycle).toHaveBeenCalledWith('', ctx);
    expect(settled).toBe(false);
    releaseLifecycle();
    await expect(pending).resolves.toEqual({ exit: true, message: 'host cleanup complete' });
  });

  it('returns { exit: true, message } when only subagents are running and the user confirms', async () => {
    const { opts, confirmExit } = makeOpts({
      leaderActive: false,
      subagentCount: 3,
      confirmResult: true,
    });
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('');
    expect(confirmExit).toHaveBeenCalledWith({ leaderActive: false, subagentCount: 3 });
    expect(res).toEqual({ exit: true, message: 'Exiting…' });
  });

  // (b) active path — confirm false
  it('returns the cancel message without invoking the host lifecycle', async () => {
    const { opts, confirmExit } = makeOpts({
      leaderActive: true,
      subagentCount: 1,
      confirmResult: false,
    });
    const runExitLifecycle = vi.fn(async () => ({ exit: true }));
    const cmd = createExitSlashCommand({ ...opts, runExitLifecycle });
    const res = await cmd.run('');
    expect(confirmExit).toHaveBeenCalledTimes(1);
    expect(runExitLifecycle).not.toHaveBeenCalled();
    expect(res).toEqual({ message: 'Exit cancelled.' });
    expect(res && (res as { exit?: boolean }).exit).toBeUndefined();
  });

  it('still asks for confirmation when only the subagent count is non-zero (leader idle)', async () => {
    const { opts, confirmExit } = makeOpts({
      leaderActive: false,
      subagentCount: 5,
      confirmResult: false,
    });
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('');
    expect(confirmExit).toHaveBeenCalledTimes(1);
    expect(confirmExit).toHaveBeenCalledWith({ leaderActive: false, subagentCount: 5 });
    expect(res).toEqual({ message: 'Exit cancelled.' });
  });

  // (c) unknown args
  it('returns the USAGE message verbatim for unknown args without consulting opts', async () => {
    const { opts, confirmExit } = makeOpts();
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('wat');
    expect(confirmExit).not.toHaveBeenCalled();
    expect(res?.message).toBe(
      'Usage:\n  /exit — terminate the TUI (asks for confirmation while work is active)',
    );
    expect(res && (res as { exit?: boolean }).exit).toBeUndefined();
  });

  it('treats a stray space-suffixed unknown arg as unknown (trims then compares)', async () => {
    const { opts, confirmExit } = makeOpts();
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('  foobar  ');
    expect(confirmExit).not.toHaveBeenCalled();
    expect(res?.message).toContain('Usage:');
  });

  // (d) --help / -h — help flags must remain non-destructive even while
  // work is active. Asking for help never silently confirms an exit the
  // user did not intend.
  it('returns USAGE for --help without consulting confirmation or host lifecycle', async () => {
    const { opts, confirmExit } = makeOpts({
      leaderActive: true,
      subagentCount: 1,
      confirmResult: true,
    });
    const runExitLifecycle = vi.fn(async () => ({ exit: true }));
    const cmd = createExitSlashCommand({ ...opts, runExitLifecycle });
    const res = await cmd.run('--help');
    expect(confirmExit).not.toHaveBeenCalled();
    expect(runExitLifecycle).not.toHaveBeenCalled();
    expect(res?.message).toContain('Usage:');
    expect(res && (res as { exit?: boolean }).exit).toBeUndefined();
  });

  it('returns USAGE for -h without consulting confirmExit', async () => {
    const { opts, confirmExit } = makeOpts({ confirmResult: false });
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('-h');
    expect(confirmExit).not.toHaveBeenCalled();
    expect(res?.message).toContain('Usage:');
    expect(res && (res as { exit?: boolean }).exit).toBeUndefined();
  });

  it('trims surrounding whitespace before rejecting the help flag as USAGE', async () => {
    const { opts, confirmExit } = makeOpts({ confirmResult: true });
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('  --help  ');
    expect(confirmExit).not.toHaveBeenCalled();
    expect(res?.message).toContain('Usage:');
    expect(res && (res as { exit?: boolean }).exit).toBeUndefined();
  });

  // Sentinel regression — the old code returned { runText: '/__exit__/confirmed' }
  // which the dispatcher turned into a follow-up user-role message rather than
  // an exit. The contract must be { exit: true } and nothing else.
  it('never returns runText on the exit path (regression for broken sentinel contract)', async () => {
    const { opts } = makeOpts({ leaderActive: true, subagentCount: 0, confirmResult: true });
    const cmd = createExitSlashCommand(opts);
    const res = await cmd.run('');
    expect(res && (res as { runText?: string }).runText).toBeUndefined();
  });

  it('snapshots leaderActive/subagentCount into the info object so the panel cannot race', async () => {
    let leader = true;
    let subs = 4;
    const confirmExit = vi.fn(async (info: { leaderActive: boolean; subagentCount: number }) => {
      // Mutate the live counters between snapshot and confirm: confirmExit must
      // have already received a stable copy.
      leader = false;
      subs = 0;
      expect(info.leaderActive).toBe(true);
      expect(info.subagentCount).toBe(4);
      return true;
    });
    const cmd = createExitSlashCommand({
      isLeaderActive: () => leader,
      countRunningSubagents: () => subs,
      confirmExit,
    });
    const res = await cmd.run('');
    expect(res).toEqual({ exit: true, message: 'Exiting…' });
    expect(confirmExit).toHaveBeenCalledTimes(1);
  });
});
