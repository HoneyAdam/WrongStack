/**
 * Agent Roster WS Handlers — exposes project-agent-identity.ts functions
 * to the WebUI for monitoring and editing custom roster agents.
 *
 * Message types (client → server):
 *   agent-roster.list        → { roles, stats, catalog }
 *   agent-roster.stats       → { role stats }
 *   agent-roster.llm-improve { role, prompt } → LLM-suggested changes
 *   agent-roster.update-identity  { role, content } → saved path
 *   agent-roster.update-learned   { role, content } → saved path
 *   agent-roster.update-config    { role, config } → saved path
 *   agent-roster.create { name, role?, baseRole?, purpose, taskTypes } → cloned project role
 *   agent-roster.reset            { role } → removed paths
 *   agent-roster.capture          { role, output? } → captured count
 *   agent-roster.consolidate      { role } → consolidation instruction + metadata
 *   agent-roster.save-consolidated { role, content, trigger?, model? } → saved path + stats
 *   agent-roster.read-consolidated { role } → consolidated content + metadata
 *   agent-roster.clear-consolidated { role } → cleared
 */

import {
  applyProjectAgentConfig,
  buildConsolidationInstruction,
  captureLearnedFromAgentOutputDetailed,
  clearProjectAgentConsolidated,
  createProjectAgent,
  detectLearnedConflicts,
  FLEET_ROSTER,
  getProjectAgentLearnStats,
  isConsolidated,
  listProjectAgentLearnedEntries,
  listProjectAgentRoles,
  loadConsolidationMetadata,
  loadProjectAgentConfig,
  loadProjectAgentConsolidated,
  loadProjectAgentIdentity,
  loadProjectAgentLearned,
  loadProjectAgentProfile,
  resetProjectAgentIdentity,
  saveProjectAgentConsolidated,
  slugifyProjectAgentRole,
  updateProjectAgentConfig,
  updateProjectAgentIdentity,
  updateProjectAgentLearned,
  updateProjectAgentLearningPolicy,
} from '@wrongstack/core/coordination';
import type { WebSocket } from 'ws';
import type { WSServerMessage } from './types.js';

export interface AgentRosterHandlerOptions {
  projectRoot: string | (() => string);
}

export class AgentRosterWSHandler {
  private readonly getProjectRoot: () => string;

  constructor(opts: AgentRosterHandlerOptions) {
    this.getProjectRoot =
      typeof opts.projectRoot === 'function' ? opts.projectRoot : () => opts.projectRoot as string;
  }

  /** Handle an incoming client message. Returns a response payload. */
  async handleMessage(_ws: WebSocket, type: string, payload: unknown): Promise<WSServerMessage> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const role = typeof p.role === 'string' ? p.role : '';
    const projectRoot = this.getProjectRoot();

    switch (type) {
      // ── List all customized roles ──────────────────────────────────────
      case 'agent-roster.list': {
        const roles = [
          ...new Set([...Object.keys(FLEET_ROSTER), ...listProjectAgentRoles(projectRoot)]),
        ].sort((a, b) => a.localeCompare(b));
        const stats = roles.map((r) => getProjectAgentLearnStats(r, projectRoot));
        const catalog = roles.map((catalogRole) => {
          const profile = loadProjectAgentProfile(catalogRole, projectRoot);
          const baseConfig =
            FLEET_ROSTER[catalogRole] ??
            (profile ? FLEET_ROSTER[profile.baseRole] : FLEET_ROSTER['generic']);
          const projectConfig = loadProjectAgentConfig(catalogRole, projectRoot);
          const config = baseConfig
            ? applyProjectAgentConfig(baseConfig, projectConfig, {
                protectSystemRole: !profile && Boolean(FLEET_ROSTER[catalogRole]),
              })
            : undefined;
          return {
            role: catalogRole,
            name: profile?.name ?? config?.name ?? catalogRole,
            summary:
              profile?.purpose ??
              config?.prompt
                ?.split('\n')
                .find((line) => line.trim().length > 20)
                ?.trim() ??
              '',
            tools: projectConfig?.tools?.length ?? config?.tools?.length ?? 0,
            custom: Boolean(profile),
            systemProtected: !profile && Boolean(FLEET_ROSTER[catalogRole]),
            baseRole: profile?.baseRole,
            taskTypes: profile?.taskTypes ?? [],
            budget: {
              timeoutMs: projectConfig?.budget?.timeoutMs ?? config?.timeoutMs,
              maxIterations: projectConfig?.budget?.maxIterations ?? config?.maxIterations,
              maxToolCalls: projectConfig?.budget?.maxToolCalls ?? config?.maxToolCalls,
            },
          };
        });
        return { type: 'agent-roster.list', payload: { roles, stats, catalog } };
      }

      // ── Stats for one role ─────────────────────────────────────────────
      case 'agent-roster.stats': {
        if (!role) return { type, payload: { error: 'role required' } };
        const stats = getProjectAgentLearnStats(role, projectRoot);
        return { type, payload: stats };
      }

      // ── LLM-driven improvement ─────────────────────────────────────────
      case 'agent-roster.llm-improve': {
        const prompt = typeof p.prompt === 'string' ? p.prompt : '';
        if (!role || !prompt) {
          return { type, payload: { error: 'role and prompt required' } };
        }
        // Read current files
        const currentStats = getProjectAgentLearnStats(role, projectRoot);

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
              `Inspect and improve the "${role}" roster agent for this project. Apply safe, focused changes directly to its project-level agent files and verify them.\n\n` +
              `Current state:\n` +
              `  identity length: ${currentStats.hasIdentity ? 'present' : 'none'}\n` +
              `  learned entries: ${currentStats.entryCount}\n` +
              `  total bytes: ${currentStats.totalBytes}\n\n` +
              `User request: ${prompt}\n\n` +
              `Preserve useful existing knowledge, do not reset unrelated agent data, and finish with a concise summary of files changed and verification performed.`,
          },
        };
      }

      // ── Update identity.md ─────────────────────────────────────────────
      case 'agent-roster.update-identity': {
        if (!role || typeof p.content !== 'string') {
          return { type, payload: { error: 'role and content required' } };
        }
        const fp = updateProjectAgentIdentity(role, p.content, projectRoot);
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Read learned.md raw content ─────────────────────────────────
      case 'agent-roster.read-learned': {
        if (!role) return { type, payload: { error: 'role required' } };
        const content = loadProjectAgentLearned(role, projectRoot) ?? '';
        const entries = listProjectAgentLearnedEntries(role, projectRoot);
        return { type, payload: { role, content, entries, entryCount: entries.length } };
      }

      case 'agent-roster.read-customization': {
        if (!role) return { type, payload: { error: 'role required' } };
        return {
          type,
          payload: {
            role,
            identity: loadProjectAgentIdentity(role, projectRoot),
            learned: loadProjectAgentLearned(role, projectRoot),
            config: loadProjectAgentConfig(role, projectRoot) ?? {},
            profile: loadProjectAgentProfile(role, projectRoot),
            systemProtected:
              !loadProjectAgentProfile(role, projectRoot) && Boolean(FLEET_ROSTER[role]),
          },
        };
      }

      case 'agent-roster.create':
      case 'agent-roster.create-generic': {
        const name = typeof p.name === 'string' ? p.name : '';
        const requestedRole = typeof p.role === 'string' ? p.role : '';
        const baseRole =
          typeof p.baseRole === 'string' && p.baseRole.trim()
            ? p.baseRole.trim().toLowerCase()
            : 'generic';
        const purpose = typeof p.purpose === 'string' ? p.purpose : '';
        const taskTypes = Array.isArray(p.taskTypes)
          ? p.taskTypes.filter((item): item is string => typeof item === 'string')
          : [];
        if (!name || !purpose || taskTypes.length === 0) {
          return { type, payload: { error: 'name, purpose and at least one task type required' } };
        }
        const newRole = (requestedRole.trim() || slugifyProjectAgentRole(name)).toLowerCase();
        if (FLEET_ROSTER[newRole]) {
          return { type, payload: { error: `built-in roster role "${newRole}" already exists` } };
        }
        const availableBaseRoles = new Set([
          ...Object.keys(FLEET_ROSTER),
          ...listProjectAgentRoles(projectRoot),
        ]);
        if (!availableBaseRoles.has(baseRole) || baseRole === newRole) {
          return { type, payload: { error: `unknown or circular base roster role "${baseRole}"` } };
        }
        const profile = createProjectAgent(
          { role: newRole, name, purpose, taskTypes, baseRole },
          projectRoot,
        );
        return {
          type,
          payload: {
            role: profile.role,
            profile,
            stats: getProjectAgentLearnStats(profile.role, projectRoot),
            success: true,
          },
        };
      }

      // ── Update learned.md ──────────────────────────────────────────────
      case 'agent-roster.update-learned': {
        if (!role || typeof p.content !== 'string') {
          return { type, payload: { error: 'role and content required' } };
        }
        const fp = updateProjectAgentLearned(role, p.content, projectRoot, 'replace');
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Append to learned.md (teach flow) ──────────────────────────────
      case 'agent-roster.append-learned': {
        const appendix = typeof p.content === 'string' ? p.content : '';
        if (!role || !appendix) {
          return { type, payload: { error: 'role and content required' } };
        }
        const fp = updateProjectAgentLearned(role, appendix, projectRoot, 'append');
        return { type, payload: { role, path: fp, success: true } };
      }

      // ── Update config.json ─────────────────────────────────────────────
      case 'agent-roster.update-config': {
        if (!role || typeof p.config !== 'object' || p.config === null || Array.isArray(p.config)) {
          return { type, payload: { error: 'role and config required' } };
        }
        const fp = updateProjectAgentConfig(
          role,
          p.config as Parameters<typeof updateProjectAgentConfig>[1],
          projectRoot,
        );
        return { type, payload: { role, path: fp, success: true } };
      }

      case 'agent-roster.update-learning': {
        if (!role || typeof p.enabled !== 'boolean') {
          return { type, payload: { error: 'role and boolean enabled required' } };
        }
        const policy = updateProjectAgentLearningPolicy(role, { enabled: p.enabled }, projectRoot);
        return {
          type,
          payload: {
            role,
            policy,
            stats: getProjectAgentLearnStats(role, projectRoot),
            success: true,
          },
        };
      }

      // ── Reset / refresh ────────────────────────────────────────────────
      case 'agent-roster.reset': {
        if (!role) return { type, payload: { error: 'role required; use "*" explicitly for all' } };
        // The underlying `resetProjectAgentIdentity` treats both `undefined` and
        // `'*'` as "reset every role". The CLI's `/agent-improve reset` slash
        // command normalises `'*'` to `undefined` before calling; the WS handler
        // does the same so both entry points agree on the wildcard contract.
        const removed = resetProjectAgentIdentity(role === '*' ? undefined : role, projectRoot);
        return { type, payload: { role, removed, success: removed.length > 0 } };
      }

      // ── Manually trigger capture ───────────────────────────────────────
      case 'agent-roster.capture': {
        const output = typeof p.output === 'string' ? p.output : '';
        if (!role) return { type, payload: { error: 'role required' } };
        // Coerce optional content to a string so the fallback never interpolates
        // the literal token "undefined" into a LEARNED block.
        const fallback = `## LEARNED\n${String(p.content ?? '')}`;
        const result = captureLearnedFromAgentOutputDetailed(
          output || fallback,
          role,
          projectRoot,
          true,
        );
        return { type, payload: result };
      }

      // ── Detect conflicts ───────────────────────────────────────────────
      case 'agent-roster.conflicts': {
        const conflicts = detectLearnedConflicts(projectRoot);
        return { type, payload: { conflicts } };
      }

      // ── Build consolidation instruction (LLM prompt) ──────────────────
      case 'agent-roster.consolidate': {
        if (!role) return { type, payload: { error: 'role required' } };
        const { instruction, rawEntries, hasExistingConsolidation } =
          buildConsolidationInstruction(role, projectRoot);
        const currentStats = getProjectAgentLearnStats(role, projectRoot);
        return {
          type: 'agent-roster.consolidate',
          payload: {
            role,
            instruction,
            rawEntryCount: rawEntries.length,
            hasExistingConsolidation,
            currentStats,
            // Instruction for the leader agent to execute the consolidation
            leaderInstruction:
              `Optimize what the "${role}" agent has learned. Read its raw learned entries, ` +
              `synthesize them into a single narrowly-scoped document preserving every fact, and ` +
              `save the result. The instruction text contains the full details and raw entries.`,
          },
        };
      }

      // ── Save consolidated document ────────────────────────────────────
      case 'agent-roster.save-consolidated': {
        if (!role || typeof p.content !== 'string') {
          return { type, payload: { error: 'role and content required' } };
        }
        const trigger =
          typeof p.trigger === 'string' && p.trigger === 'automatic' ? 'automatic' : 'manual';
        const model = typeof p.model === 'string' ? p.model : undefined;
        const fp = saveProjectAgentConsolidated(role, p.content, projectRoot, {
          trigger,
          ...(model ? { model } : {}),
        });
        const stats = getProjectAgentLearnStats(role, projectRoot);
        return {
          type: 'agent-roster.save-consolidated',
          payload: { role, path: fp, success: true, stats },
        };
      }

      // ── Read consolidated document ────────────────────────────────────
      case 'agent-roster.read-consolidated': {
        if (!role) return { type, payload: { error: 'role required' } };
        const content = loadProjectAgentConsolidated(role, projectRoot);
        const metadata = loadConsolidationMetadata(role, projectRoot);
        const consolidated = isConsolidated(role, projectRoot);
        return {
          type: 'agent-roster.read-consolidated',
          payload: { role, content, metadata, isConsolidated: consolidated },
        };
      }

      // ── Clear consolidated document ───────────────────────────────────
      case 'agent-roster.clear-consolidated': {
        if (!role) return { type, payload: { error: 'role required' } };
        clearProjectAgentConsolidated(role, projectRoot);
        return { type, payload: { role, success: true } };
      }

      default:
        return { type, payload: { error: `Unknown agent-roster action: ${type}` } };
    }
  }
}
