import type { Capabilities, ModelsRegistry } from '@wrongstack/core';
import { capabilitiesForFamily } from './family-capabilities.js';

/**
 * Resolve capabilities for a (provider, model) pair using the family default
 * as a baseline and overlaying per-model facts from the ModelsRegistry.
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
  return {
    ...base,
    tools: model.capabilities.tools && base.tools,
    parallelTools: model.capabilities.tools && base.parallelTools,
    vision: model.capabilities.vision && base.vision,
    maxContext: model.capabilities.maxContext || base.maxContext,
  };
}
