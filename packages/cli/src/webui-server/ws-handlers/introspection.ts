import type { Agent, ConfigStore, ModelsRegistry, SkillLoader } from '@wrongstack/core';
import type { WebSocket } from 'ws';
import { computeUsageCost, getCostRates } from '../cost-helpers.js';
import type { WsCommon } from './index.js';
import { toErrorMessage } from '@wrongstack/core/utils';

/**
 * PR 5c of Issue #30: introspection WebSocket handlers
 * (`skills.list`, `tools.list`, `tool.enable`, `tool.disable`, `diag.get`, `stats.get`).
 *
 * Most cases snapshot live run state (the agent context, the tool registry,
 * the skill loader, token usage) and send it to the browser. Tool enable/disable
 * is included here because it mutates the registry/config that tools.list
 * introspects.
 */

export interface IntrospectionContext extends WsCommon {
  /** The running agent — read for ctx (provider/model/usage/messages/…) and tools. */
  agent: Agent;
  /** Skill loader backing skills.list (optional — absent ⇒ feature disabled). */
  skillLoader: SkillLoader | undefined;
  /** Models registry, used by stats.get to price token usage (optional). */
  modelsRegistry: ModelsRegistry | undefined;
  /** Project root reported by diag.get (falls back to ctx.projectRoot). */
  projectRoot: string | undefined;
  /** Active session id. */
  sessionId: string;
  /** Epoch ms when the run started — stats.get reports elapsed time. */
  sessionStartedAt: number;
  /** Config store used to persist tool enable/disable changes when available. */
  configStore?: ConfigStore | undefined;
}

function currentSessionId(ctx: IntrospectionContext): string {
  return ctx.agent.ctx.session?.id ?? ctx.sessionId;
}

interface ToolLike {
  name: string;
  description?: string | undefined;
  inputSchema?: { properties?: Record<string, unknown> } | undefined;
  mutating?: boolean | undefined;
  permission?: string | undefined;
}

interface ToolEntryLike {
  tool: ToolLike;
  owner: string;
}

function toolEntries(ctx: IntrospectionContext): ToolEntryLike[] {
  const registry = ctx.agent.tools as unknown as {
    list?: () => ToolLike[];
    listWithOwner?: () => ToolEntryLike[];
    listDisabled?: () => ToolEntryLike[];
  };
  if (typeof registry.listWithOwner === 'function') {
    return [
      ...registry.listWithOwner(),
      ...(typeof registry.listDisabled === 'function' ? registry.listDisabled() : []),
    ];
  }
  return (registry.list?.() ?? []).map((tool) => ({ tool, owner: 'core' }));
}

function persistDisabledTool(ctx: IntrospectionContext, name: string, disabled: boolean): void {
  const configStore = ctx.configStore;
  if (!configStore) return;
  const currentTools = configStore.get().tools ?? {};
  const disabledTools = new Set(currentTools.disabledTools ?? []);
  if (disabled) disabledTools.add(name);
  else disabledTools.delete(name);
  configStore.update({ tools: { ...currentTools, disabledTools: Array.from(disabledTools) } });
}

function toolNameFromPayload(payload: unknown): string | undefined {
  const name = (payload as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
}

export async function handleSkillsList(ctx: IntrospectionContext, ws: WebSocket): Promise<void> {
  if (!ctx.skillLoader) {
    ctx.send(ws, { type: 'skills.list', payload: { skills: [], enabled: false } });
    return;
  }
  try {
    const manifests = await ctx.skillLoader.list();
    const entries = await ctx.skillLoader.listEntries();
    const byName = new Map(entries.map((e) => [e.name, e]));
    ctx.send(ws, {
      type: 'skills.list',
      payload: {
        enabled: true,
        skills: manifests.map((m) => ({
          name: m.name,
          description: m.description,
          version: m.version ?? '',
          source: m.source,
          path: m.path,
          trigger: byName.get(m.name)?.trigger ?? '',
          scope: byName.get(m.name)?.scope ?? [],
        })),
      },
    });
  } catch (err) {
    ctx.send(ws, {
      type: 'skills.list',
      payload: {
        skills: [],
        enabled: true,
        error: toErrorMessage(err),
      },
    });
  }
}

export function handleToolsList(ctx: IntrospectionContext, ws: WebSocket): void {
  const registry = ctx.agent.tools as unknown as { isDisabled?: (name: string) => boolean };
  const list = toolEntries(ctx).map(({ tool, owner }) => {
    const schema =
      (tool as { inputSchema?: { properties?: Record<string, unknown> } }).inputSchema ?? {};
    const params = schema.properties ? Object.keys(schema.properties) : [];
    return {
      name: tool.name,
      owner,
      description: tool.description ?? '',
      params,
      disabled: registry.isDisabled?.(tool.name) ?? false,
      mutating: !!tool.mutating,
      permission: tool.permission ?? 'auto',
    };
  });
  ctx.send(ws, { type: 'tools.list', payload: { tools: list } });
}

export function handleToolDisable(
  ctx: IntrospectionContext,
  ws: WebSocket,
  payload: unknown,
): void {
  const name = toolNameFromPayload(payload);
  if (!name) {
    ctx.send(ws, { type: 'error', payload: { message: 'tool.disable requires a name' } });
    return;
  }
  const ok = ctx.agent.tools.disable(name);
  if (ok) persistDisabledTool(ctx, name, true);
  ctx.send(ws, { type: 'tool.disabled', payload: { name, ok } });
}

export function handleToolEnable(
  ctx: IntrospectionContext,
  ws: WebSocket,
  payload: unknown,
): void {
  const name = toolNameFromPayload(payload);
  if (!name) {
    ctx.send(ws, { type: 'error', payload: { message: 'tool.enable requires a name' } });
    return;
  }
  const ok = ctx.agent.tools.enable(name);
  if (ok) persistDisabledTool(ctx, name, false);
  ctx.send(ws, { type: 'tool.enabled', payload: { name, ok } });
}

export function handleDiagGet(ctx: IntrospectionContext, ws: WebSocket): void {
  // Snapshot of key metrics — mirrors the standalone server's handler
  // and the CLI /diag output. Uses the agent context for live state.
  const actx = ctx.agent.ctx;
  const tools = ctx.agent.tools.list();
  ctx.send(ws, {
    type: 'diag.get',
    payload: {
      provider: (actx.provider as { id: string }).id,
      model: actx.model,
      cwd: ctx.projectRoot ?? actx.projectRoot,
      sessionId: currentSessionId(ctx),
      tools: {
        count: tools.length,
        names: tools.map((t) => t.name),
      },
      features: {},
      mode: 'default',
      usage: actx.tokenCounter.total(),
      messages: actx.messages.length,
      todos: actx.todos.length,
    },
  });
}

export async function handleStatsGet(ctx: IntrospectionContext, ws: WebSocket): Promise<void> {
  // Detailed session usage stats, mirroring the CLI /stats.
  const actx = ctx.agent.ctx;
  const usage = actx.tokenCounter.total();
  const cacheStats = actx.tokenCounter.cacheStats();
  let cost: number | null = null;
  try {
    if (ctx.modelsRegistry) {
      const model = await ctx.modelsRegistry.getModel(
        (actx.provider as { id: string }).id,
        actx.model,
      );
      const rates = getCostRates(model);
      cost = computeUsageCost(
        { input: usage.input, output: usage.output, cacheRead: cacheStats.readTokens },
        rates,
      );
    }
  } catch {
    /* cost stays null */
  }
  ctx.send(ws, {
    type: 'stats.get',
    payload: {
      sessionId: currentSessionId(ctx),
      provider: (actx.provider as { id: string }).id,
      model: actx.model,
      usage,
      cache: cacheStats,
      cost,
      messages: actx.messages.length,
      readFiles: actx.readFiles.size,
      tools: ctx.agent.tools.list().length,
      elapsedMs: Date.now() - ctx.sessionStartedAt,
    },
  });
}
