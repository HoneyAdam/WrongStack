import { describe, expect, it, vi } from 'vitest';
import { buildFleetCommand } from '../src/slash-commands/fleet.js';

function ctx() {
  return { session: { id: 's1' } } as never;
}

describe('buildFleetCommand', () => {
  it('reports multi-agent not enabled when onFleet missing', async () => {
    const cmd = buildFleetCommand({} as never);
    const res = await cmd.run('', ctx());
    expect(res?.message).toContain('Multi-agent is not enabled');
  });

  it('empty args defaults to status', async () => {
    const onFleet = vi.fn().mockResolvedValue('STATUS_OUT');
    const cmd = buildFleetCommand({ onFleet } as never);
    const res = await cmd.run('', ctx());
    expect(onFleet).toHaveBeenCalledWith('status', undefined);
    expect(res?.message).toBe('STATUS_OUT');
  });

  it('routes status / usage / manifest verbs directly', async () => {
    const onFleet = vi.fn().mockResolvedValue('X');
    const cmd = buildFleetCommand({ onFleet } as never);
    await cmd.run('status', ctx());
    await cmd.run('usage', ctx());
    await cmd.run('manifest', ctx());
    expect(onFleet).toHaveBeenNthCalledWith(1, 'status', undefined);
    expect(onFleet).toHaveBeenNthCalledWith(2, 'usage', undefined);
    expect(onFleet).toHaveBeenNthCalledWith(3, 'manifest', undefined);
  });

  it('kill without id reports usage', async () => {
    const cmd = buildFleetCommand({ onFleet: vi.fn() } as never);
    const res = await cmd.run('kill', ctx());
    expect(res?.message).toContain('Usage: /fleet kill <subagent-id>');
  });

  it('kill with id forwards to onFleet', async () => {
    const onFleet = vi.fn().mockResolvedValue('killed');
    const cmd = buildFleetCommand({ onFleet } as never);
    const res = await cmd.run('kill sub-123', ctx());
    expect(onFleet).toHaveBeenCalledWith('kill', 'sub-123');
    expect(res?.message).toBe('killed');
  });

  it('retry without director handler reports availability', async () => {
    const cmd = buildFleetCommand({ onFleet: vi.fn() } as never);
    const res = await cmd.run('retry', ctx());
    expect(res?.message).toContain('Retry is only available when director mode');
  });

  it('retry forwards to onFleetRetry with no target', async () => {
    const onFleetRetry = vi.fn().mockResolvedValue('list');
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      onFleetRetry,
    } as never);
    const res = await cmd.run('retry', ctx());
    expect(onFleetRetry).toHaveBeenCalledWith(undefined);
    expect(res?.message).toBe('list');
  });

  it('retry forwards specific taskId', async () => {
    const onFleetRetry = vi.fn().mockResolvedValue('retried');
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      onFleetRetry,
    } as never);
    await cmd.run('retry task-42', ctx());
    expect(onFleetRetry).toHaveBeenCalledWith('task-42');
  });

  it('log without handler reports unavailable', async () => {
    const cmd = buildFleetCommand({ onFleet: vi.fn() } as never);
    const res = await cmd.run('log sub-1', ctx());
    expect(res?.message).toContain('Log inspection is only available');
  });

  it('log lists transcripts when called without id', async () => {
    const onFleetLog = vi.fn().mockResolvedValue('listing');
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      onFleetLog,
    } as never);
    await cmd.run('log', ctx());
    expect(onFleetLog).toHaveBeenCalledWith(undefined, 'summary');
  });

  it('log with id uses summary mode by default', async () => {
    const onFleetLog = vi.fn().mockResolvedValue('summary');
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      onFleetLog,
    } as never);
    await cmd.run('log sub-7', ctx());
    expect(onFleetLog).toHaveBeenCalledWith('sub-7', 'summary');
  });

  it('log with id + "raw" uses raw mode', async () => {
    const onFleetLog = vi.fn().mockResolvedValue('raw-out');
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      onFleetLog,
    } as never);
    await cmd.run('log sub-7 raw', ctx());
    expect(onFleetLog).toHaveBeenCalledWith('sub-7', 'raw');
  });

  it('stream without controller reports TUI-only', async () => {
    const cmd = buildFleetCommand({ onFleet: vi.fn() } as never);
    const res = await cmd.run('stream on', ctx());
    expect(res?.message).toContain('only available in the TUI');
  });

  it('stream (no arg) reports current state', async () => {
    const ctrl = { enabled: true, setEnabled: vi.fn() };
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      fleetStreamController: ctrl,
    } as never);
    const res = await cmd.run('stream', ctx());
    expect(res?.message).toBe('Fleet streaming is on.');
  });

  it('stream status sub-verb reports current state', async () => {
    const ctrl = { enabled: false, setEnabled: vi.fn() };
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      fleetStreamController: ctrl,
    } as never);
    const res = await cmd.run('stream status', ctx());
    expect(res?.message).toBe('Fleet streaming is off.');
  });

  it('stream invalid arg reports usage', async () => {
    const ctrl = { enabled: false, setEnabled: vi.fn() };
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      fleetStreamController: ctrl,
    } as never);
    const res = await cmd.run('stream maybe', ctx());
    expect(res?.message).toContain('Usage: /fleet stream on|off');
  });

  it('stream on flips controller', async () => {
    const ctrl = { enabled: false, setEnabled: vi.fn() };
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      fleetStreamController: ctrl,
    } as never);
    const res = await cmd.run('stream on', ctx());
    expect(ctrl.setEnabled).toHaveBeenCalledWith(true);
    expect(ctrl.enabled).toBe(true);
    expect(res?.message).toBe('Fleet streaming enabled.');
  });

  it('stream off flips controller', async () => {
    const ctrl = { enabled: true, setEnabled: vi.fn() };
    const cmd = buildFleetCommand({
      onFleet: vi.fn(),
      fleetStreamController: ctrl,
    } as never);
    const res = await cmd.run('stream off', ctx());
    expect(ctrl.setEnabled).toHaveBeenCalledWith(false);
    expect(res?.message).toBe('Fleet streaming disabled.');
  });

  it('help / ? render the help block', async () => {
    const cmd = buildFleetCommand({ onFleet: vi.fn() } as never);
    expect((await cmd.run('help', ctx()))?.message).toMatch(/inspect or control/);
    expect((await cmd.run('?', ctx()))?.message).toMatch(/inspect or control/);
  });

  it('unknown verb shows hint listing valid ones', async () => {
    const cmd = buildFleetCommand({ onFleet: vi.fn() } as never);
    const res = await cmd.run('frobulate', ctx());
    expect(res?.message).toContain('Unknown subcommand "frobulate"');
    expect(res?.message).toContain('status | usage');
  });
});
