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
 * The presets are product-specific defaults for Kimi Code subscription,
 * the metered Moonshot Platform, and Z.AI's pay-as-you-go API. Z.AI
 * Coding Plan is intentionally absent because Z.AI's subscription terms
 * limit plan quota to officially supported tools.
 */

describe('TRUSTED_PROVIDER_PRESETS', () => {
  it('contains the three product-scoped presets as of 2026-07-15', () => {
    const ids = listTrustedProviderPresetIds().sort();
    expect(ids).toEqual(['kimi-for-coding', 'moonshotai', 'zai']);
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

  it('Z.AI preset is the pay-as-you-go API, NOT the Coding Plan', () => {
    const preset = TRUSTED_PROVIDER_PRESETS.zai;
    expect(preset).toBeDefined();
    expect(preset!.baseUrl).toBe('https://api.z.ai/api/paas/v4');
    expect(preset!.envVars).toEqual(['ZHIPU_API_KEY']);
    expect(preset!.models).toEqual(['glm-4.7', 'glm-5-turbo', 'glm-5.2']);
    expect(preset!.quirks?.thinkingParam).toBe('zai-glm');
    expect(preset!.usage).toBe('metered-api');
    // No `zai-coding-plan` preset — Coding Plan is intentionally absent
    // until Z.AI lists WrongStack as a supported tool.
    expect(TRUSTED_PROVIDER_PRESETS['zai-coding-plan']).toBeUndefined();
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
    expect(resolvePresetForAlias('kimi-for-coding')?.id).toBe('kimi-for-coding');
    expect(resolvePresetForAlias('moonshotai')?.id).toBe('moonshotai');
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