import type { Capabilities, ModelsRegistry } from '@wrongstack/core';
import { capabilitiesForFamily } from './family-capabilities.js';

/**
 * Resolve capabilities for a (provider, model) pair using the family default
 * as a baseline and overlaying per-model facts from the ModelsRegistry.
 *
 * Priority for maxContext:
 *  1. model.capabilities.maxContext  — from registry getModel() (limit.context)
 *  2. raw model limit.context         — direct from provider.models fallback
 *  3. base.maxContext                — family default (e.g. 32K for openai-compatible)
 */
export async function capabilitiesFor(
  registry: ModelsRegistry,
  providerId: string,
  modelId: string,
): Promise<Capabilities> {
  const provider = await registry.getProvider(providerId);
  const base = capabilitiesForFamily(provider?.family ?? 'unsupported');
  const model = await registry.getModel(providerId, modelId);
  if (!model) return { ...base };

  // maxContext priority:
  //  1. model.capabilities.maxContext   — from registry getModel() (mapped from limit.context)
  //  2. raw model limit.context         — direct lookup in provider.models
  //  3. raw model limit.output          — some models.dev entries only report output
  //  4. base.maxContext                 — family default as ultimate fallback
  const rawModel = provider?.models.find((m) => m.id === modelId);
  const catalogMaxContext =
    model.capabilities.maxContext ||
    rawModel?.limit?.context ||
    rawModel?.limit?.output ||
    base.maxContext;

  return {
    ...base,
    tools: model.capabilities.tools && base.tools,
    parallelTools: model.capabilities.tools && base.parallelTools,
    vision: model.capabilities.vision && base.vision,
    maxContext: catalogMaxContext,
  };
}
