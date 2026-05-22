import { describe, expect, it, vi } from 'vitest';
import { buildMcpSlashCommand } from '../src/slash-commands/mcp.js';

describe('buildMcpSlashCommand', () => {
  it('returns a SlashCommand with the expected metadata', () => {
    const cmd = buildMcpSlashCommand({ onMcp: vi.fn() } as never);
    expect(cmd.name).toBe('mcp');
    expect(cmd.aliases).toContain('mcp-servers');
    expect(cmd.description).toContain('Manage MCP servers');
    expect(cmd.help).toContain('Usage:');
    expect(cmd.help).toContain('add <name>');
  });

  it('reports unavailable when no onMcp callback is wired', async () => {
    const cmd = buildMcpSlashCommand({} as never);
    const res = await cmd.run('list');
    expect(res?.message).toContain('not available');
  });

  it('trims args and forwards the result of onMcp as the message', async () => {
    const onMcp = vi.fn().mockResolvedValue('OK from onMcp');
    const cmd = buildMcpSlashCommand({ onMcp } as never);
    const res = await cmd.run('  list  ');
    expect(onMcp).toHaveBeenCalledWith('list');
    expect(res?.message).toBe('OK from onMcp');
  });

  it('forwards empty string when args is whitespace only', async () => {
    const onMcp = vi.fn().mockResolvedValue('empty');
    const cmd = buildMcpSlashCommand({ onMcp } as never);
    await cmd.run('   ');
    expect(onMcp).toHaveBeenCalledWith('');
  });

  it('also re-exports parseMcpArgs and runMcpManagementCommand via the barrel', async () => {
    const mod = await import('../src/slash-commands/mcp.js');
    expect(typeof mod.parseMcpArgs).toBe('function');
    expect(typeof mod.runMcpManagementCommand).toBe('function');
  });
});
