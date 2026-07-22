/**
 * Agent Roster WS Handlers — exposes project-agent-identity.ts functions
 * to the WebUI for monitoring and editing custom roster agents.
 *
 * Message types (client → server):
 *   agent-roster.list        → { roles: string[] }
 *   agent-roster.stats       → { role stats }
 *   agent-roster.llm-improve { role, prompt } → LLM-suggested changes
 *   agent-roster.update-identity  { role, content } → saved path
 *   agent-roster.update-learned   { role, content } → saved path
 *   agent-roster.update-config    { role, config } → saved path
 *   agent-roster.reset            { role } → removed paths
 *   agent-roster.capture          { role, output? } → captured count
 *
 * Server → client broadcast:
 *   agent-roster.stats-update  → periodic stats for visible roles
 */

import type { WebSocket } from 'ws';
import {
  getProjectAgentLearnStats,
  listProjectAgentRoles,
  captureLearnedFromAgentOutput,
  updateProjectAgentIdentity,
  updateProjectAgentLearned,
  updateProjectAgentConfig,
  resetProjectAgentIdentity,
  detectLearnedConflicts,
  loadProjectAgentLearned,
} from '@wrongstack/core/coordination';
import type { WSServerMessage } from './types.js';

export interface AgentRosterHandlerOptions {
  projectRoot: string;
}

export class AgentRosterWSHandler {
  private readonly clients = new Set<WebSocket>();
  private readonly projectRoot: string;

  constructor(opts: AgentRosterHandlerOptions) {
    this.projectRoot = opts.projectRoot;
  }

  /** Register a new WS client for roster data. */
  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
  }

  /** Handle an incoming client message. Returns a response payload. */
  async handleMessage(
    _ws: WebSocket,
    type: string,
    payload: unknown,
  ): Promise<WSServerMessage> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const role = typeof p.role === 'string' ? p.role : '';

    switch (type) {
      // ── List all customized roles ──────────────────────────────────────
      case 'agent-roster.list': {
        const roles = listProjectAgentRoles(this.projectRoot);
        const stats = roles.map((r) => getProjectAgentLearnStats(r, this.projectRoot));
        return { type: 'agent-roster.list', payload: { roles, stats } };
      }

      // ── Stats for one role ─────────────────────────────────────────────
      case 'agent-roster.stats': {
        if (!role) return { type, payload: { error: 'role required' } };
        const stats = getProjectAgentLearnStats(role, this.projectRoot);
        return { type, payload: stats };
      }

      // ── LLM-driven improvement ─────────────────────────────────────────
      case 'agent-roster.llm-improve': {
        const prompt = typeof p.prompt === 'string' ? p.prompt : '';
        if (!role || !prompt) {
          return { type, payload: { error: 'role and prompt required' } };
        }
        // Read current files
        const currentStats = getProjectAgentLearnStats(role, this.projectRoot);

        // The CLI/agent will process this via `/agent-improve` flow.
        // Return a structured suggestion request that the frontend submits
        // to the leader agent.
        return {
          type: 'agent-roster.llm-improve',
          payload: {
            role,
            prompt,
            currentStats,
            instruction:
              `Improve the "${role}" agent for this project.\n\n` +
              `Current state:\n` +
              `  identity length: ${currentStats.hasIdentity ? 'present' : 'none'}\n` +
              `  learned entries: ${currentStats.entryCount}\n` +
              `  total bytes: ${currentStats.totalBytes}\n\n` +
              `User request: ${prompt}\n\n` +
              `Respond with:\n` +
              `1. A revised identity.md\n` +
              `2. New learned.md content (optional)\n` +
              `3. config.json changes (optional)\n` +
              `4. Summary of changes`,
          },
        };
      }

      // ── Update identity.md ─────────────────────────────────────────────
      case 'agent-roster.update-identity': {
        const content = typeof p.content === 'string' ? p.content : '';
        if (!role || !content) {
          return { type, payload: { error: 'role and content required' } };
        }
        const fp = updateProjectAgentIdentity(role, content, this.projectRoot);
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Read learned.md raw content ─────────────────────────────────
      case 'agent-roster.read-learned': {
        if (!role) return { type, payload: { error: 'role required' } };
        const content = loadProjectAgentLearned(role, this.projectRoot) ?? '';
        const entries = content
          ? content.split('\n---\n').filter(Boolean).map((e) => e.trim()).filter(Boolean)
          : [];
        return { type, payload: { role, content, entries, entryCount: entries.length } };
      }

      // ── Update learned.md ──────────────────────────────────────────────
      case 'agent-roster.update-learned': {
        const content = typeof p.content === 'string' ? p.content : '';
        if (!role || !content) {
          return { type, payload: { error: 'role and content required' } };
        }
        const fp = updateProjectAgentLearned(role, content, this.projectRoot, 'replace');
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Append to learned.md (teach flow) ──────────────────────────────
      case 'agent-roster.append-learned': {
        const appendix = typeof p.content === 'string' ? p.content : '';
        if (!role || !appendix) {
          return { type, payload: { error: 'role and content required' } };
        }
        const fp = updateProjectAgentLearned(role, appendix, this.projectRoot, 'append');
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Update config.json ─────────────────────────────────────────────
      case 'agent-roster.update-config': {
        if (!role || !p.config) {
          return { type, payload: { error: 'role and config required' } };
        }
        const fp = updateProjectAgentConfig(role, p.config as Record<string, unknown>, this.projectRoot);
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Reset / refresh ────────────────────────────────────────────────
      case 'agent-roster.reset': {
        const removed = resetProjectAgentIdentity(role || undefined, this.projectRoot);
        return { type, payload: { role, removed, success: removed.length > 0 } };
      }

      // ── Manually trigger capture ───────────────────────────────────────
      case 'agent-roster.capture': {
        const output = typeof p.output === 'string' ? p.output : '';
        const count = captureLearnedFromAgentOutput(
          output || `## LEARNED\n${p.content ?? ''}`,
          role,
          this.projectRoot,
          true,
        );
        return { type, payload: { role, captured: count } };
      }

      // ── Detect conflicts ───────────────────────────────────────────────
      case 'agent-roster.conflicts': {
        const conflicts = detectLearnedConflicts(this.projectRoot);
        return { type, payload: { conflicts } };
      }

      default:
        return { type, payload: { error: `Unknown agent-roster action: ${type}` } };
    }
  }
}
