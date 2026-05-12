import type { Capabilities, ModelsRegistry, WireFamily } from '@wrongstack/core';

const BASE_BY_FAMILY: Record<WireFamily, Capabilities> = {
  anthropic: {
    tools: true,
    parallelTools: true,
    vision: true,
    streaming: true,
    promptCache: true,
    systemPrompt: true,
    jsonMode: false,
    maxContext: 200_000,
    cacheControl: 'native',
  },
  openai: {
    tools: true,
    parallelTools: true,
    vision: true,
    streaming: true,
    promptCache: false,
    systemPrompt: true,
    jsonMode: true,
    maxContext: 128_000,
    cacheControl: 'auto',
  },
  'openai-compatible': {
    tools: true,
    parallelTools: true,
    vision: false,
    streaming: true,
    promptCache: false,
    systemPrompt: true,
    jsonMode: false,
    maxContext: 32_000,
    cacheControl: 'none',
  },
  google: {
    tools: true,
    parallelTools: true,
    vision: true,
    streaming: true,
    promptCache: false,
    systemPrompt: true,
    jsonMode: true,
    maxContext: 1_000_000,
    cacheControl: 'none',
  },
  unsupported: {
    tools: false,
    parallelTools: false,
    vision: false,
    streaming: false,
    promptCache: false,
    systemPrompt: false,
    jsonMode: false,
    maxContext: 0,
    cacheControl: 'none',
  },
};

function baseFor(family: WireFamily): Capabilities {
  return BASE_BY_FAMILY[family] ?? BASE_BY_FAMILY.unsupported;
}

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
  const base = baseFor(provider?.family ?? 'unsupported');
  const model = await registry.getModel(providerId, modelId);
  if (!model) return { ...base };
  return {
    ...base,
    tools: model.capabilities.tools && base.tools,
    vision: model.capabilities.vision && base.vision,
    maxContext: model.capabilities.maxContext || base.maxContext,
  };
}
