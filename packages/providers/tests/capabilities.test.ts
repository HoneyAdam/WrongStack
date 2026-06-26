import * as os from 'node:os';
import * as path from 'node:path';
import { DefaultModelsRegistry, type CustomModelDefinition, type ModelsDevPayload } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from '../src/capabilities.js';

const SAMPLE: ModelsDevPayload = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY'],
    npm: '@ai-sdk/anthropic',
    models: {
      'claude-sonnet-4-6': {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet',
        tool_call: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 200_000, output: 64_000 },
      },
      'claude-text-only': {
        id: 'claude-text-only',
        name: 'Claude Text Only',
        tool_call: false,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 100_000, output: 8_192 },
      },
    },
  },
  google: {
    id: 'google',
    name: 'Google',
    env: ['GEMINI_API_KEY'],
    npm: '@ai-sdk/google',
    models: {
      'gemini-2.5-flash': {
        id: 'gemini-2.5-flash',
        name: 'Gemini',
        tool_call: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1_000_000, output: 8_192 },
      },
    },
  },
};

function reg() {
  return new DefaultModelsRegistry({
    cacheFile: path.join(os.tmpdir(), `wstack-cap-${Date.now()}.json`),
    seed: SAMPLE,
  });
}

describe('capabilitiesFor', () => {
  it('anthropic + claude has native cache control', async () => {
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6');
    expect(c.cacheControl).toBe('native');
    expect(c.tools).toBe(true);
    expect(c.vision).toBe(true);
    expect(c.maxContext).toBe(200_000);
  });

  it('google has 1M context default', async () => {
    const c = await capabilitiesFor(reg(), 'google', 'gemini-2.5-flash');
    expect(c.maxContext).toBe(1_000_000);
  });

  it('unknown model still returns family baseline', async () => {
    const c = await capabilitiesFor(reg(), 'anthropic', 'mystery-model');
    expect(c.cacheControl).toBe('native');
  });

  it('unknown provider falls back to unsupported', async () => {
    const c = await capabilitiesFor(reg(), 'nonexistent', 'foo');
    expect(c.tools).toBe(false);
  });

  it('model without explicit capabilities still returns family baseline', async () => {
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6');
    expect(c.tools).toBe(true);
    expect(c.vision).toBe(true);
    expect(c.maxContext).toBe(200_000);
  });

  it('model-level tool and vision limits narrow the family baseline', async () => {
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-text-only');
    expect(c.tools).toBe(false);
    expect(c.parallelTools).toBe(false);
    expect(c.vision).toBe(false);
    expect(c.cacheControl).toBe('native');
    expect(c.maxContext).toBe(100_000);
  });

  // ---- custom model overrides ----

  it('custom model overrides maxContext on known model', async () => {
    const custom: Record<string, CustomModelDefinition> = {
      'claude-sonnet-4-6': { capabilities: { maxContext: 500_000 } },
    };
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6', custom);
    expect(c.maxContext).toBe(500_000);
    // Non-overridden fields still come from catalog
    expect(c.tools).toBe(true);
    expect(c.vision).toBe(true);
    expect(c.cacheControl).toBe('native');
  });

  it('custom model overrides capabilities flags on known model', async () => {
    const custom: Record<string, CustomModelDefinition> = {
      'claude-sonnet-4-6': { capabilities: { tools: false, vision: false } },
    };
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6', custom);
    expect(c.tools).toBe(false);
    expect(c.vision).toBe(false);
    expect(c.cacheControl).toBe('native');
    expect(c.maxContext).toBe(200_000);
  });

  it('custom model defines capabilities for unknown model', async () => {
    const custom: Record<string, CustomModelDefinition> = {
      'local-llama': { capabilities: { maxContext: 8192, tools: true, vision: false } },
    };
    const c = await capabilitiesFor(reg(), 'anthropic', 'local-llama', custom);
    expect(c.maxContext).toBe(8192);
    expect(c.tools).toBe(true);
    expect(c.vision).toBe(false);
    // Falls back to family baseline for unset fields
    expect(c.cacheControl).toBe('native');
  });

  it('custom model for unknown provider uses custom caps only', async () => {
    const custom: Record<string, CustomModelDefinition> = {
      'my-model': { capabilities: { maxContext: 32_000, tools: true, streaming: true } },
    };
    const c = await capabilitiesFor(reg(), 'ollama', 'my-model', custom);
    expect(c.maxContext).toBe(32_000);
    expect(c.tools).toBe(true);
    expect(c.streaming).toBe(true);
    // Unsupportable fields fall to unsupported family baseline
    expect(c.vision).toBe(false);
  });

  it('custom model partial override merges with catalog', async () => {
    const custom: Record<string, CustomModelDefinition> = {
      'claude-sonnet-4-6': { capabilities: { streaming: false } },
    };
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6', custom);
    expect(c.streaming).toBe(false);
    // Rest unchanged
    expect(c.tools).toBe(true);
    expect(c.maxContext).toBe(200_000);
  });

  // ---- maxOutput (drives subagent Request.maxTokens, e.g. Chimera) ----

  it('reads maxOutput from models.dev limit.output', async () => {
    // Anthropic family has no hard-coded maxOutput in family-capabilities
    // anymore — it must come from the catalog. If the model has
    // `limit.output`, capabilitiesFor propagates it; otherwise it's
    // undefined and the caller (agent-response) falls back to 8192.
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6');
    expect(c.maxOutput).toBe(64_000);
  });

  it('returns undefined maxOutput when neither catalog nor custom supplies it', async () => {
    // An unknown model on the anthropic family has no `limit.output`
    // entry and no family default — must surface as undefined so
    // agent-response applies its 8192 fallback rather than fabricating
    // a value.
    const c = await capabilitiesFor(reg(), 'anthropic', 'mystery-model');
    expect(c.maxOutput).toBeUndefined();
  });

  it('custom model can override maxOutput independently of the catalog', async () => {
    const custom: Record<string, CustomModelDefinition> = {
      'claude-sonnet-4-6': { capabilities: { maxOutput: 32_000 } },
    };
    const c = await capabilitiesFor(reg(), 'anthropic', 'claude-sonnet-4-6', custom);
    // Custom wins over the catalog's 64_000
    expect(c.maxOutput).toBe(32_000);
  });
});
