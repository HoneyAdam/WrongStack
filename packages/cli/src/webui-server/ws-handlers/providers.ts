import type { ProviderConfig } from '@wrongstack/core';
import { DefaultSecretScrubber, resolveProviderModelList } from '@wrongstack/core';
import {
  buildProviderConfigFromPreset,
  rehydrateCanonicalProviderConfig,
  resolvePresetForAlias,
} from '@wrongstack/providers';
import { probeLocalLlm } from '@wrongstack/runtime/probe';
import type { WebSocket } from 'ws';
import { toErrorMessage } from '@wrongstack/core/utils';
import {
  expectDefined,
  maskedKey,
  normalizeKeys,
  nowIso,
  writeKeysBack,
} from '../provider-config.js';
import { type AgentConfigContext, applyModelSwitch } from './agent-config.js';
import type { WsHandlerContext } from './index.js';

/**
 * PR 5 of Issue #30: provider / model / API-key WebSocket handlers.
 *
 * Extracted from the `runWebUI` closure in webui-server.ts. Every former
 * closure capture is now a field on `ctx: WsHandlerContext` — no hidden
 * state: `opts.modelsRegistry` → `ctx.modelsRegistry`, the
 * globalConfigPath-bound provider IO → `ctx.providerStore`, and
 * `send`/`broadcast`/`console.log` → `ctx.send`/`broadcast`/`log`.
 */

/**
 * Module-private result helper. webui-server.ts keeps its own
 * `sendResult` (used by ~80 other switch cases); this is the
 * provider-group copy so these handlers don't depend on it.
 */
function sendResult(ctx: WsHandlerContext, ws: WebSocket, success: boolean, message: string): void {
  ctx.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

/** Shared scrubber for provider health probes — redacts secrets from probe detail. */
const probeScrubber = new DefaultSecretScrubber();

/**
 * Hydrate a not-yet-saved provider config from a trusted preset when the
 * supplied id (or its `<id>-suffix` alias) maps to a canonical preset.
 * Mutates `dest` in place; returns the canonical preset id for `cfg.type`
 * fallback. Returns `undefined` for ids outside the trusted table.
 */
function hydrateTrustedPreset(providerId: string, dest: ProviderConfig): string | undefined {
  const preset = resolvePresetForAlias(providerId);
  if (!preset) return undefined;
  const template = buildProviderConfigFromPreset(preset);
  if (!dest.type) dest.type = preset.id;
  if (!dest.family) dest.family = preset.family;
  if (dest.baseUrl === undefined) dest.baseUrl = template.baseUrl;
  if (!dest.envVars || dest.envVars.length === 0) dest.envVars = template.envVars;
  if (!dest.models || dest.models.length === 0) dest.models = template.models;
  if (template.customModels && (!dest.customModels || Object.keys(dest.customModels).length === 0)) {
    dest.customModels = template.customModels;
  }
  if (template.quirks && dest.quirks === undefined) dest.quirks = template.quirks;
  return preset.id;
}

/**
 * Probe a saved provider's OpenAI-compatible `/v1/models` and map the
 * discovered ids into the same descriptor shape `resolveProviderModelList`
 * emits, so the WebUI model dropdown can render them. Returns `[]` on any
 * failure (unreachable, auth error, non-OpenAI shape) — the caller treats
 * that identically to "no models resolved".
 */
async function probeModelDescriptors(
  cfg: ProviderConfig,
): Promise<Array<{ id: string; name: string; capabilities: [] }>> {
  if (!cfg.baseUrl) return [];
  try {
    const keys = normalizeKeys(cfg);
    const active = keys.find((k) => k.label === cfg.activeKey) ?? keys[0];
    const result = await probeLocalLlm({
      baseUrl: cfg.baseUrl,
      apiKey: active?.apiKey,
      noAuth: false,
      scrubber: probeScrubber,
    });
    if (!result.ok || !result.modelIds) return [];
    return result.modelIds.map((id) => ({ id, name: id, capabilities: [] as [] }));
  } catch {
    return [];
  }
}

/**
 * Re-broadcast the saved-providers projection to every client. Shared by the
 * mutating provider handlers (add / update / clear / undo) so all surfaces
 * re-render the same masked snapshot after a change.
 */
function projectSavedProviders(providers: Record<string, ProviderConfig>) {
  return Object.entries(providers).map(([id, cfg]) => {
    const models = cfg.models;
    const pickedModelId = models && models.length > 0 ? models[0] : undefined;
    return {
      id,
      family: cfg.family ?? id,
      baseUrl: cfg.baseUrl,
      models,
      ...(pickedModelId !== undefined ? { pickedModelId } : {}),
      apiKeys: normalizeKeys(cfg).map((k) => ({
        label: k.label,
        maskedKey: maskedKey(k.apiKey),
        isActive: k.label === cfg.activeKey,
        createdAt: k.createdAt,
      })),
    };
  });
}

export function broadcastSaved(
  ctx: WsHandlerContext,
  providers: Record<string, ProviderConfig>,
): void {
  ctx.broadcast({
    type: 'providers.saved',
    payload: { providers: projectSavedProviders(providers) },
  });
}

export async function handleProvidersList(ctx: WsHandlerContext, ws: WebSocket): Promise<void> {
  if (!ctx.modelsRegistry) {
    sendResult(ctx, ws, false, 'Models registry not available');
    return;
  }
  try {
    const providers = await ctx.modelsRegistry.listProviders();
    const savedProviders = await ctx.providerStore.load();
    const savedIds = new Set(Object.keys(savedProviders));

    ctx.send(ws, {
      type: 'provider.catalog',
      payload: {
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          family: p.family,
          apiBase: p.apiBase,
          envVars: p.envVars,
          modelCount: p.models.length,
          hasApiKey: savedIds.has(p.id) || p.envVars.some((v) => !!process.env[v]),
        })),
      },
    });
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

export async function handleProviderModels(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
): Promise<void> {
  if (!ctx.modelsRegistry) {
    sendResult(ctx, ws, false, 'Models registry not available');
    return;
  }
  try {
    // Resolve models from the merged catalog (models.dev + the curated overlay)
    // AND the saved config. Most OAuth / subscription providers (github-copilot,
    // anthropic-oauth, …) are absent from models.dev — their model list lives
    // only in the saved config. openai-codex is a partial exception: the
    // overlay adds it, so getProvider() may return catalog metadata; but the
    // saved allowlist is still authoritative and wins via resolveProviderModelList.
    // The switcher lazy-loads every saved provider, so a catalog miss must yield
    // the saved allowlist (or an empty list), never an error result — that error
    // path produced a "not found in catalog" toast per non-catalog provider.
    const saved = await ctx.providerStore.load();
    const cfg = saved[providerId];
    const catalogId = cfg?.type && cfg.type !== providerId ? cfg.type : providerId;
    const provider = await ctx.modelsRegistry.getProvider(catalogId);
    // Also resolve the sibling catalog (e.g. `openai` for `openai-codex`)
    // so subscription users see both the curated overlay models AND the
    // wire-family models from models.dev they may have access to.
    const SIBLING_CATALOG: Record<string, string> = {
      'anthropic-oauth': 'anthropic',
      'openai-codex': 'openai',
      'github-copilot': 'openai',
    };
    const siblingId = SIBLING_CATALOG[providerId];
    const siblingCatalog =
      siblingId && siblingId !== providerId
        ? await ctx.modelsRegistry.getProvider(siblingId).catch(() => undefined)
        : undefined;
    let models = resolveProviderModelList(
      cfg?.models,
      provider,
      cfg?.type ?? providerId,
      siblingCatalog,
    );
    // A config-only custom provider with no saved `models` allowlist and no
    // catalog entry resolves to an EMPTY list — the WebUI model dropdown then
    // shows "no models". If it exposes an OpenAI-compatible `/v1/models`, probe
    // it live so the user can actually pick a model. Best-effort: a down server
    // just leaves the list empty (unchanged from before).
    if (models.length === 0 && cfg?.baseUrl) {
      models = await probeModelDescriptors(cfg);
    }
    ctx.send(ws, {
      type: 'provider.models',
      payload: { provider: providerId, models },
    });
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

export async function handleProvidersSaved(ctx: WsHandlerContext, ws: WebSocket): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    ctx.send(ws, {
      type: 'providers.saved',
      payload: { providers: projectSavedProviders(providers) },
    });
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

export async function handleKeyUpsert(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
  label: string,
  apiKey: string,
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    let existing = providers[providerId];
    if (!existing) {
      // New entry: hydrate product-locked fields from the trusted-preset
      // table when the id (or its `<id>-suffix` alias) maps to a canonical
      // vendor entry. Mirrors the webui-server preset hydration so the
      // CLI-embedded WebUI and the standalone server stay aligned.
      existing = { type: providerId };
      const presetId = hydrateTrustedPreset(providerId, existing);
      if (presetId) existing.type = presetId;
    } else {
      // Existing setup cards send key.add. Rehydrate exact canonical ids so
      // stale wire families/model aliases cannot make a fresh key unusable.
      rehydrateCanonicalProviderConfig(providerId, existing);
    }
    const keys = normalizeKeys(existing);

    // Check if label exists
    const existingIdx = keys.findIndex((k) => k.label === label);
    if (existingIdx >= 0) {
      keys[existingIdx] = { ...expectDefined(keys[existingIdx]), apiKey, createdAt: nowIso() };
    } else {
      keys.push({ label, apiKey, createdAt: nowIso() });
    }

    writeKeysBack(existing, keys);
    if (!existing.activeKey) existing.activeKey = label;
    providers[providerId] = existing;

    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Key "${label}" saved for ${providerId}`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

export async function handleKeyDelete(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
  label: string,
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    const existing = providers[providerId];
    if (!existing) {
      sendResult(ctx, ws, false, `Provider "${providerId}" not found`);
      return;
    }
    const keys = normalizeKeys(existing).filter((k) => k.label !== label);
    if (keys.length === 0) {
      delete providers[providerId];
    } else {
      writeKeysBack(existing, keys);
      if (existing.activeKey === label) {
        existing.activeKey = keys[0]?.label;
      }
      providers[providerId] = existing;
    }
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Key "${label}" deleted from ${providerId}`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

export async function handleKeySetActive(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
  label: string,
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    const existing = providers[providerId];
    if (!existing) {
      sendResult(ctx, ws, false, `Provider "${providerId}" not found`);
      return;
    }
    existing.activeKey = label;
    writeKeysBack(existing, normalizeKeys(existing));
    providers[providerId] = existing;
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Active key for ${providerId} set to "${label}"`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

export async function handleProviderAdd(
  ctx: WsHandlerContext,
  ws: WebSocket,
  payload: {
    id: string;
    family: string;
    baseUrl?: string | undefined;
    apiKey?: string | undefined;
  },
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    if (providers[payload.id]) {
      sendResult(
        ctx,
        ws,
        false,
        `Provider "${payload.id}" already exists. Use key.add to add a key.`,
      );
      return;
    }
    const newProv: ProviderConfig = {
      type: payload.id,
      family: payload.family as ProviderConfig['family'],
      baseUrl: payload.baseUrl,
    };
    const presetId = hydrateTrustedPreset(payload.id, newProv);
    if (presetId) newProv.type = presetId;
    if (payload.apiKey) {
      newProv.apiKeys = [{ label: 'default', apiKey: payload.apiKey, createdAt: nowIso() }];
      newProv.activeKey = 'default';
    }
    providers[payload.id] = newProv;
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Provider "${payload.id}" added`);
    ctx.log(`[WebUI] Provider "${payload.id}" added via provider.add`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

/**
 * Adopt `providerId` as the live agent's active provider/model when the agent
 * has no usable model yet — the in-session counterpart to the boot auto-select,
 * so the first provider a user adds in the WebUI is immediately usable instead
 * of leaving a blank model. No-op (never hijacks) once any model is active.
 * Resolves the model from the saved allowlist, then the catalog, then a live
 * `/v1/models` probe. Best-effort: a failure just leaves the state unchanged.
 */
export async function adoptDefaultProviderIfUnset(
  agentCtx: AgentConfigContext,
  wsCtx: WsHandlerContext,
  providerId: string,
): Promise<void> {
  if (agentCtx.agent.ctx.model) return; // already has a usable default
  const saved = await wsCtx.providerStore.load();
  const cfg = saved[providerId];
  if (!cfg) return;

  let model = cfg.models?.[0];
  if (!model && wsCtx.modelsRegistry) {
    const catalogId = cfg.type && cfg.type !== providerId ? cfg.type : providerId;
    const catalog = await wsCtx.modelsRegistry.getProvider(catalogId).catch(() => undefined);
    model = catalog?.models?.[0]?.id;
  }
  if (!model) {
    const probed = await probeModelDescriptors(cfg);
    model = probed[0]?.id;
  }
  if (!model) return;

  try {
    await applyModelSwitch(agentCtx, providerId, model);
  } catch {
    /* best-effort — the model becomes the default on the next session start */
  }
}

export async function handleProviderRemove(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    if (!providers[providerId]) {
      sendResult(ctx, ws, false, `Provider "${providerId}" not found`);
      return;
    }
    delete providers[providerId];
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Provider "${providerId}" removed`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

/** Drop a provider's model allowlist (so the full catalog is offered again). */
export async function handleProviderClearModels(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    const cfg = providers[providerId];
    if (!cfg) {
      sendResult(ctx, ws, false, `Unknown provider "${providerId}"`);
      return;
    }
    delete cfg.models;
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Cleared model allowlist for ${providerId}`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

/** Restore a previously-cleared model allowlist (pairs with clear). */
export async function handleProviderUndoClear(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
  previousModels: string[],
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    const cfg = providers[providerId];
    if (!cfg) {
      sendResult(ctx, ws, false, `Unknown provider "${providerId}"`);
      return;
    }
    cfg.models = [...previousModels];
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Restored ${previousModels.length} model(s) for ${providerId}`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

/** Update a saved provider's wire config (family / baseUrl / envVars / models). */
export async function handleProviderUpdate(
  ctx: WsHandlerContext,
  ws: WebSocket,
  payload: {
    id: string;
    family?: string | undefined;
    baseUrl?: string | undefined;
    envVars?: string[] | undefined;
    models?: string[] | undefined;
  },
): Promise<void> {
  try {
    const providers = await ctx.providerStore.load();
    const cfg = providers[payload.id];
    if (!cfg) {
      sendResult(ctx, ws, false, `Unknown provider "${payload.id}"`);
      return;
    }
    if (payload.family !== undefined) cfg.family = payload.family as ProviderConfig['family'];
    if (payload.baseUrl !== undefined) cfg.baseUrl = payload.baseUrl;
    if (payload.envVars !== undefined) cfg.envVars = payload.envVars;
    if (payload.models !== undefined) cfg.models = payload.models;
    await ctx.providerStore.save(providers);
    sendResult(ctx, ws, true, `Updated ${payload.id}`);
    broadcastSaved(ctx, providers);
  } catch (err) {
    sendResult(ctx, ws, false, toErrorMessage(err));
  }
}

/**
 * Run a health probe against a saved provider's `/v1/models` and reply with a
 * `provider.probe` message. Never throws — the probe result carries the
 * failure mode in its `status`.
 */
export async function handleProviderProbe(
  ctx: WsHandlerContext,
  ws: WebSocket,
  providerId: string,
  timeoutMs?: number,
): Promise<void> {
  const reply = (payload: Record<string, unknown>): void =>
    ctx.send(ws, { type: 'provider.probe', payload: { providerId, ...payload } });
  try {
    const providers = await ctx.providerStore.load();
    const cfg = providers[providerId];
    if (!cfg) {
      reply({ ok: false, status: 'no_provider' });
      return;
    }
    if (!cfg.baseUrl) {
      reply({ ok: false, status: 'no_base_url' });
      return;
    }
    const keys = normalizeKeys(cfg);
    const active = keys.find((k) => k.label === cfg.activeKey) ?? keys[0];
    const result = await probeLocalLlm({
      baseUrl: cfg.baseUrl,
      apiKey: active?.apiKey,
      noAuth: false,
      scrubber: probeScrubber,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    reply(result as never as Record<string, unknown>);
  } catch (err) {
    reply({ ok: false, status: 'unreachable', detail: toErrorMessage(err) });
  }
}
