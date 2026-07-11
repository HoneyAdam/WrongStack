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

  it('lists resources and templates through the live registry', async () => {
    const mcpRegistry = {
      listResources: vi
        .fn()
        .mockResolvedValue([
          { uri: 'repo://README.md', name: 'readme', mimeType: 'text/markdown', size: 42 },
        ]),
      listResourceTemplates: vi
        .fn()
        .mockResolvedValue([{ uriTemplate: 'repo://{path}', name: 'repository file' }]),
    };
    const cmd = buildMcpSlashCommand({ mcpRegistry } as never);

    const res = await cmd.run('resources docs --refresh');

    expect(mcpRegistry.listResources).toHaveBeenCalledWith('docs', { refresh: true });
    expect(res?.message).toContain('repo://README.md');
    expect(res?.message).toContain('repo://{path}');
  });

  it('lists prompts and required argument names', async () => {
    const mcpRegistry = {
      listPrompts: vi.fn().mockResolvedValue([
        {
          name: 'review',
          description: 'Review code',
          arguments: [{ name: 'target', required: true }],
        },
      ]),
    };
    const cmd = buildMcpSlashCommand({ mcpRegistry } as never);

    const res = await cmd.run('prompts docs');

    expect(res?.message).toContain('review (target*) — Review code');
  });

  it('inserts only an explicitly selected resource with provenance metadata', async () => {
    const insertion = {
      kind: 'resource',
      untrusted: true,
      byteSize: 5,
      provenance: {
        origin: 'mcp',
        serverName: 'docs',
        capability: 'resource',
        resourceUri: 'repo://guide',
      },
      contents: [{ uri: 'repo://guide', text: 'hello' }],
    };
    const mcpRegistry = { selectResourceForInsertion: vi.fn().mockResolvedValue(insertion) };
    const cmd = buildMcpSlashCommand({ mcpRegistry } as never);

    const res = await cmd.run('read docs repo://guide');

    expect(res?.message).toContain('untrusted MCP resource');
    expect(res?.runText).toContain('[UNTRUSTED MCP CONTENT');
    expect(res?.runText).toContain('repo://guide');
    expect(res?.metadata).toEqual({ mcpInsertion: insertion.provenance });
  });

  it('passes prompt arguments and never includes argument values in metadata', async () => {
    const insertion = {
      kind: 'prompt',
      untrusted: true,
      byteSize: 12,
      provenance: {
        origin: 'mcp',
        serverName: 'docs',
        capability: 'prompt',
        promptName: 'review',
        promptArgumentNames: ['token'],
      },
      messages: [{ role: 'user', content: { type: 'text', text: 'review' } }],
    };
    const mcpRegistry = { selectPromptForInsertion: vi.fn().mockResolvedValue(insertion) };
    const cmd = buildMcpSlashCommand({ mcpRegistry } as never);

    const res = await cmd.run('get docs review token=secret-value');

    expect(mcpRegistry.selectPromptForInsertion).toHaveBeenCalledWith('docs', 'review', {
      token: 'secret-value',
    });
    expect(JSON.stringify(res?.metadata)).not.toContain('secret-value');
  });

  it('rejects malformed prompt key/value arguments before calling the registry', async () => {
    const mcpRegistry = { selectPromptForInsertion: vi.fn() };
    const cmd = buildMcpSlashCommand({ mcpRegistry } as never);

    const res = await cmd.run('get docs review malformed');

    expect(res?.message).toContain('expected key=value');
    expect(mcpRegistry.selectPromptForInsertion).not.toHaveBeenCalled();
  });
});
