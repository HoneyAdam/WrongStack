import { describe, expect, it } from 'vitest';
import { FLEET_ROSTER } from '../../src/coordination/fleet.js';

const expectedSshTools = [
  'mcp__ssh__ssh_list_servers',
  'mcp__ssh__ssh_connection_status',
  'mcp__ssh__ssh_execute',
  'mcp__ssh__ssh_execute_sudo',
  'mcp__ssh__ssh_upload',
  'mcp__ssh__ssh_download',
  'mcp__ssh__ssh_sync',
  'mcp__ssh__ssh_deploy',
  'mcp__ssh__ssh_health_check',
  'mcp__ssh__ssh_service_status',
  'mcp__ssh__ssh_process_manager',
  'mcp__ssh__ssh_tunnel',
  'mcp__ssh__ssh_backup_create',
  'mcp__ssh__ssh_backup_list',
  'mcp__ssh__ssh_backup_restore',
  'mcp__ssh__ssh_db_list',
  'mcp__ssh__ssh_db_query',
  'mcp__ssh__ssh_profile',
];

describe('DevOps SSH MCP tool slice', () => {
  it('exposes direct SSH MCP tools for remote-host work', () => {
    const tools = FLEET_ROSTER.devops?.tools ?? [];

    for (const name of expectedSshTools) {
      expect(tools).toContain(name);
    }
  });

  it('does not grant broad MCP lifecycle/meta tools to DevOps by default', () => {
    const tools = FLEET_ROSTER.devops?.tools ?? [];

    expect(tools).not.toContain('mcp_control');
    expect(tools).not.toContain('mcp_use');
  });
});
