import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@wrongstack/core';
import { buildShadowCommand } from '../src/slash-commands/shadow.js';

function ctx(): Context {
  return {} as never as Context;
}

function shadowController(activeId: string | null = null) {
  const controller = {
    activeId,
    register: vi.fn((id: string) => {
      controller.activeId = id;
    }),
    clear: vi.fn(() => {
      controller.activeId = null;
    }),
  };
  return controller;
}

describe('buildShadowCommand', () => {
  it('start parses interval and provider/model before spawning', async () => {
    const onSpawn = vi.fn(async () => 'sub-shadow');
    const cmd = buildShadowCommand({
      onSpawn,
      shadowController: shadowController(),
    } as never);

    const res = await cmd.run('start --interval=15000 --model=openai/gpt-5', ctx());

    expect(onSpawn).toHaveBeenCalledWith(
      'Shadow Agent — background fleet monitor at 15000ms interval',
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5',
        name: 'shadow',
        tools: expect.arrayContaining(['fleet_status', 'terminate_subagent']),
      }),
    );
    expect(res?.message).toContain('openai/gpt-5');
  });

  it('start rejects invalid interval values without spawning', async () => {
    const onSpawn = vi.fn(async () => 'sub-shadow');
    const cmd = buildShadowCommand({
      onSpawn,
      shadowController: shadowController(),
    } as never);

    const res = await cmd.run('start --interval=abc', ctx());

    expect(onSpawn).not.toHaveBeenCalled();
    expect(res?.message).toContain('interval must be an integer');
  });

  it('start refuses a duplicate registered shadow agent', async () => {
    const onSpawn = vi.fn(async () => 'sub-shadow');
    const cmd = buildShadowCommand({
      onSpawn,
      shadowController: shadowController('sub-existing'),
    } as never);

    const res = await cmd.run('start', ctx());

    expect(onSpawn).not.toHaveBeenCalled();
    expect(res?.message).toContain('already running');
  });

  it('stop terminates the registered shadow agent and clears the controller', async () => {
    const controller = shadowController('sub-shadow');
    const onFleetTerminate = vi.fn(() => true);
    const cmd = buildShadowCommand({
      onFleetTerminate,
      shadowController: controller,
    } as never);

    const res = await cmd.run('stop', ctx());

    expect(onFleetTerminate).toHaveBeenCalledWith('sub-shadow');
    expect(controller.clear).toHaveBeenCalledTimes(1);
    expect(controller.activeId).toBeNull();
    expect(res?.message).toContain('stopped');
  });

  it('hoop terminates a specific target agent', async () => {
    const onFleetTerminate = vi.fn(() => true);
    const onAgents = vi.fn(() => 'Agent sub-123\n  status: running');
    const cmd = buildShadowCommand({
      onAgents,
      onFleetTerminate,
      shadowController: shadowController('sub-shadow'),
    } as never);

    const res = await cmd.run('hoop sub-123 --reason=looping', ctx());

    expect(onAgents).toHaveBeenCalledWith('sub-123');
    expect(onFleetTerminate).toHaveBeenCalledWith('sub-123');
    expect(res?.message).toContain('Stopped agent');
    expect(res?.message).toContain('looping');
  });

  it('hoop all kills the fleet and clears the shadow controller', async () => {
    const controller = shadowController('sub-shadow');
    const onFleetKill = vi.fn(() => 3);
    const cmd = buildShadowCommand({
      onFleetKill,
      shadowController: controller,
    } as never);

    const res = await cmd.run('hoop all --reason=wedged', ctx());

    expect(onFleetKill).toHaveBeenCalledTimes(1);
    expect(controller.clear).toHaveBeenCalledTimes(1);
    expect(res?.message).toContain('Stopped 3 running agent');
  });
});
