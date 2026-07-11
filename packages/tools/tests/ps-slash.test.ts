import { describe, expect, it, vi } from 'vitest';
import { createGlobalPsSlashCommand } from '../src/ps-slash.js';

// Mock the persistent process registry
vi.mock('../src/process-registry-persistent.js', () => {
  const mockRegistry = {
    getInstanceId: () => 'test-instance-1',
    getGlobalStatus: vi.fn().mockResolvedValue({
      instances: new Map(),
      totalProcesses: 0,
      protectedCount: 0,
      staleCount: 0,
    }),
  };

  return {
    getPersistentProcessRegistry: () => mockRegistry,
    PersistentProcessRegistry: class {},
  };
});

describe('ps-slash command', () => {
  it('returns a slash command object with name and description', () => {
    const cmd = createGlobalPsSlashCommand();
    expect(cmd.name).toBe('ps');
    expect(cmd.description).toBeDefined();
    expect(typeof cmd.description).toBe('string');
    expect(cmd.description.length).toBeGreaterThan(0);
  });

  it('returns a handler function', () => {
    const cmd = createGlobalPsSlashCommand();
    expect(typeof cmd.handler).toBe('function');
  });

  it('handler returns a message object', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('');
    expect(result).toHaveProperty('message');
    expect(typeof result.message).toBe('string');
  });

  it('list subcommand (default) shows instance list', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('');
    expect(result.message).toContain('WrongStack Instances');
  });

  it('list subcommand works with "list" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('list');
    expect(result.message).toContain('WrongStack Instances');
  });

  it('list subcommand works with "ls" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('ls');
    expect(result.message).toContain('WrongStack Instances');
  });

  it('summary subcommand shows compact output', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('summary');
    expect(result.message).toContain('instance');
  });

  it('summary subcommand works with "sum" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('sum');
    expect(result.message).toContain('instance');
  });

  it('full subcommand shows global process status', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('full');
    expect(result.message).toContain('Global Process Status');
  });

  it('full subcommand works with "detail" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('detail');
    expect(result.message).toContain('Global Process Status');
  });

  it('count subcommand shows instance count', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('count');
    expect(result.message).toContain('instance');
    expect(result.message).toContain('active');
  });

  it('count subcommand works with "num" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('num');
    expect(result.message).toContain('instance');
  });

  it('hostname subcommand requires a pattern', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('hostname');
    expect(result.message).toContain('Usage');
  });

  it('hostname subcommand works with a pattern', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('hostname *');
    expect(result.message).toBeDefined();
  });

  it('hostname subcommand works with "host" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('host test-*');
    expect(result.message).toBeDefined();
  });

  it('status subcommand requires a valid state', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('status');
    expect(result.message).toContain('Usage');
  });

  it('status subcommand rejects invalid state', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('status unknown');
    expect(result.message).toContain('Usage');
  });

  it('status subcommand works with valid active state', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('status active');
    expect(result.message).toBeDefined();
  });

  it('status subcommand works with "state" keyword', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('state all');
    expect(result.message).toBeDefined();
  });

  it('status idle filter works', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('status idle');
    expect(result.message).toBeDefined();
  });

  it('status stale filter works', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('status stale');
    expect(result.message).toBeDefined();
  });

  it('unknown subcommand shows usage', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('unknown-command');
    expect(result.message).toContain('Usage');
  });

  it('empty input works (defaults to list)', async () => {
    const cmd = createGlobalPsSlashCommand();
    const result = await cmd.handler('   ');
    expect(result.message).toBeDefined();
  });
});
