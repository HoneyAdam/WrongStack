import { describe, expect, it } from 'vitest';
import {
  TRUSTED_PROVIDER_PRESETS,
  buildProviderConfigFromPreset,
  getTrustedProviderPreset,
  isTrustedProviderId,
  listTrustedProviderPresetIds,
  resolvePresetForAlias,
} from '../src/index.js';

/**
 * Pure tests for the trusted-preset table. The same constants are
 * consumed by both the standalone @wrongstack/webui-server and the
 * CLI-embedded WS handler, so a regression here breaks both surfaces.
 *
 * Presets cover product-specific endpoints (Kimi Code, Moonshot, Z.AI,
 * MiniMax), general-purpose API providers (DeepSeek, Groq, Perplexity),
 * and the meta-provider OpenRouter. Presets that list models in
 * `provider/model-name` format (OpenRouter) expect users to add more
 * model IDs from the provider's catalog.
 */

describe('TRUSTED_PROVIDER_PRESETS', () => {
  it('contains all product-scoped and general-purpose presets', () => {
    const ids = listTrustedProviderPresetIds().sort();
    expect(ids).toEqual([
      'deepseek',
      'groq',
      'kimi-for-coding',
      'minimax',
      'moonshotai',
      'openrouter',
      'perplexity',
      'zai',
      'zai-coding-plan',
    ]);
  });

  it('Kimi Code preset points at the documented Kimi Code endpoint and aliases', () => {
    const preset = TRUSTED_PROVIDER_PRESETS['kimi-for-coding'];
    expect(preset).toBeDefined();
    expect(preset!.family).toBe('openai-compatible');
    expect(preset!.baseUrl).toBe('https://api.kimi.com/coding/v1');
    expect(preset!.envVars).toEqual(['KIMI_API_KEY']);
    expect(preset!.models).toEqual(['kimi-for-coding', 'kimi-for-coding-highspeed']);
    // K2.7 always streams reasoning as delta.reasoning_content and the
    // `kimi-toggle` quirk ensures an explicit disable is emitted instead
    // of dropped (see packages/providers/src/openai-compatible.ts).
    expect(preset!.quirks?.thinkingParam).toBe('kimi-toggle');
    expect(preset!.usage).toBe('subscription-interactive');
  });

  it('Moonshot Platform preset is the metered product, distinct from Kimi Code', () => {
    const preset = TRUSTED_PROVIDER_PRESETS.moonshotai;
    expect(preset).toBeDefined();
    expect(preset!.baseUrl).toBe('https://api.moonshot.ai/v1');
    expect(preset!.envVars).toEqual(['MOONSHOT_API_KEY']);
    expect(preset!.models).toEqual(['kimi-k2.7-code', 'kimi-k2.7-code-highspeed']);
    expect(preset!.quirks?.thinkingParam).toBe('always-on');
    expect(preset!.usage).toBe('metered-api');
  });

  it('Z.AI metered preset is distinct from the Coding Plan subscription', () => {
    const preset = TRUSTED_PROVIDER_PRESETS.zai;
    expect(preset).toBeDefined();
    expect(preset!.baseUrl).toBe('https://api.z.ai/api/paas/v4');
    expect(preset!.envVars).toEqual(['ZHIPU_API_KEY']);
    expect(preset!.models).toEqual(['glm-4.7', 'glm-5-turbo', 'glm-5.2']);
    expect(preset!.quirks?.thinkingParam).toBe('zai-glm');
    expect(preset!.usage).toBe('metered-api');
  });

  it('Z.AI Coding Plan subscription preset uses the dedicated Coding Plan endpoint', () => {
    const preset = TRUSTED_PROVIDER_PRESETS['zai-coding-plan'];
    expect(preset).toBeDefined();
    expect(preset!.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(preset!.usage).toBe('subscription-interactive');
  });

  it('MiniMax Token Plan preset points at the MiniMax API with current models', () => {
    const preset = TRUSTED_PROVIDER_PRESETS.minimax;
    expect(preset).toBeDefined();
    expect(preset!.baseUrl).toBe('https://api.minimax.io/v1');
    expect(preset!.envVars).toEqual(['MINIMAX_API_KEY']);
    expect(preset!.models).toContain('MiniMax-M3');
    expect(preset!.usage).toBe('subscription-interactive');
  });
});

describe('getTrustedProviderPreset / isTrustedProviderId', () => {
  it('returns the preset for canonical ids', () => {
    const preset = getTrustedProviderPreset('kimi-for-coding');
    expect(preset?.id).toBe('kimi-for-coding');
    expect(isTrustedProviderId('kimi-for-coding')).toBe(true);
  });

  it('returns undefined for unrecognised ids without throwing', () => {
    expect(getTrustedProviderPreset('anthropic')).toBeUndefined();
    expect(getTrustedProviderPreset('not-a-provider')).toBeUndefined();
    expect(isTrustedProviderId('anthropic')).toBe(false);
  });
});

describe('resolvePresetForAlias', () => {
  it('matches the canonical id exactly', () => {
    expect(resolvePresetForAlias('deepseek')?.id).toBe('deepseek');
    expect(resolvePresetForAlias('groq')?.id).toBe('groq');
    expect(resolvePresetForAlias('kimi-for-coding')?.id).toBe('kimi-for-coding');
    expect(resolvePresetForAlias('moonshotai')?.id).toBe('moonshotai');
    expect(resolvePresetForAlias('openrouter')?.id).toBe('openrouter');
    expect(resolvePresetForAlias('perplexity')?.id).toBe('perplexity');
    expect(resolvePresetForAlias('zai')?.id).toBe('zai');
  });

  it('matches <canonical>-<suffix> custom aliases so a second key can be saved without losing the preset defaults', () => {
    expect(resolvePresetForAlias('kimi-for-coding-work')?.id).toBe('kimi-for-coding');
    expect(resolvePresetForAlias('kimi-for-coding-team-eu')?.id).toBe('kimi-for-coding');
    expect(resolvePresetForAlias('moonshotai-prod')?.id).toBe('moonshotai');
    expect(resolvePresetForAlias('zai-staging')?.id).toBe('zai');
  });

  it('does NOT match short prefixes that would steal the canonical id', () => {
    // `kimi` is a substring of `kimi-for-coding` but not a `<id>-suffix` form
    // — the generic registration path must handle it, not the preset
    // hydration (which would otherwise overwrite the user's endpoint).
    expect(resolvePresetForAlias('kimi')).toBeUndefined();
    expect(resolvePresetForAlias('moonshot')).toBeUndefined();
    expect(resolvePresetForAlias('za')).toBeUndefined();
  });

  it('chooses the longest matching prefix when several presets could match', () => {
    // Both `moonshotai` and `zai` are valid candidate prefixes for
    // `moonshotai-foo`; the resolver must pick the longer match.
    expect(resolvePresetForAlias('moonshotai-foo')?.id).toBe('moonshotai');
  });

  it('returns undefined for arbitrary ids', () => {
    expect(resolvePresetForAlias('openai')).toBeUndefined();
    expect(resolvePresetForAlias('custom-gateway-1')).toBeUndefined();
  });
});

describe('buildProviderConfigFromPreset', () => {
  it('produces a deep-cloned config — callers may mutate without aliasing the preset', () => {
    const preset = TRUSTED_PROVIDER_PRESETS['kimi-for-coding']!;
    const cfg = buildProviderConfigFromPreset(preset);
    cfg.baseUrl = 'https://attacker.example/';
    cfg.models?.push('rogue-model');
    expect(preset.baseUrl).toBe('https://api.kimi.com/coding/v1');
    expect(preset.models).toEqual(['kimi-for-coding', 'kimi-for-coding-highspeed']);
  });

  it('uses the preset id as the canonical type', () => {
    const cfg = buildProviderConfigFromPreset(TRUSTED_PROVIDER_PRESETS['kimi-for-coding']!);
    expect(cfg.type).toBe('kimi-for-coding');
    expect(cfg.family).toBe('openai-compatible');
  });

  it('copies env vars so subsequent mutations do not bleed back', () => {
    const cfg = buildProviderConfigFromPreset(TRUSTED_PROVIDER_PRESETS.moonshotai!);
    cfg.envVars?.push('EXTRA');
    expect(TRUSTED_PROVIDER_PRESETS.moonshotai!.envVars).toEqual(['MOONSHOT_API_KEY']);
  });

  it('omits optional fields when the preset does not define them', () => {
    // Currently every preset has quirks/models — guard against future
    // presets that legitimately lack one.
    const cfg = buildProviderConfigFromPreset({
      ...TRUSTED_PROVIDER_PRESETS.zai,
      quirks: undefined,
    });
    expect(cfg.quirks).toBeUndefined();
  });
});