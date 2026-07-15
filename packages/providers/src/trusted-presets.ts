/**
 * Trusted provider presets — vendor-maintained defaults for provider IDs
 * whose product-specific base URL, model allowlist, env vars, and
 * compatibility quirks cannot be derived from the models.dev catalog alone
 * (or would otherwise leak into the user-typed `provider.add` payload).
 *
 * Why a separate module:
 *  - The user-facing setup flow only ships `id`/`family`/`apiKey`; without
 *    a trusted resolver, an OpenAI-compatible provider pointing at
 *    `https://api.kimi.com/coding/v1` would work in the wire but skip the
 *    Kimi-specific reasoning toggle and overwrite the user's explicit base
 *    URL. We persist the canonical product defaults server-side instead.
 *  - Vendor endpoints and model IDs change rarely but matter for
 *    correctness (e.g. the Kimi HighSpeed alias consumes ~3× subscription
 *    quota). Centralising them here keeps the CLI, TUI auth-menu, and
 *    WebUI setup cards aligned.
 *
 * Coverage is intentionally narrow: only providers that need product-aware
 * server-side hydration are listed. Generic OpenAI-compatible gateways
 * (omniroute, LiteLLM, etc.) still rely on user-supplied baseUrl/models.
 */

import type { CustomModelDefinition, ProviderConfig, WireFamily } from '@wrongstack/core';
import type { CompatibilityQuirks } from './openai-compatible.js';

/**
 * One trusted preset. `id` is the canonical provider id used in
 * `providers.<id>` and on the wire; `family` is the wire family the
 * factory must use; `baseUrl`/`envVars`/`models`/`customModels`/`quirks`
 * are merged into a fresh ProviderConfig so callers do not need to know
 * them.
 *
 * `docsUrl` and `usage` are UI hints surfaced by setup cards and the TUI
 * auth menu — they do not change runtime behaviour.
 */
export interface TrustedProviderPreset {
  /** Canonical provider id (also the user-visible alias in WrongStack). */
  id: string;
  /** Display name for the setup card / auth-menu row. */
  name: string;
  /**
   * Wire family — drives which factory builds the provider. Use
   * `'openai-compatible'` for vendors whose API is documented as
   * OpenAI-compatible (Bearer + Chat Completions shape). Use `'anthropic'`
   * for Anthropic-Messages-compatible proxies.
   */
  family: WireFamily;
  /** Default base URL; required so users only ever paste the key. */
  baseUrl: string;
  /** Env var names to probe for the API key. */
  envVars: string[];
  /** Canonical model id allowlist. */
  models: string[];
  /**
   * Per-model definitions (capability overrides). These ride alongside
   * `models` so the WebUI model list can render reasoning/maxContext
   * without consulting the network catalog. Optional.
   */
  customModels?: Record<string, CustomModelDefinition>;
  /** OpenAI-compatible wire quirks — defaults already validated. */
  quirks?: CompatibilityQuirks;
  /** Human-facing usage class — guides future access controls. */
  usage?: 'metered-api' | 'subscription-interactive' | 'subscription-team';
  /** Public docs URL surfaced in the setup card. */
  docsUrl?: string;
}

/**
 * Canonical trusted presets.
 *
 * Sourced from each vendor's public API/CLI documentation current as of
 * 2026-07-15. Update only after re-verifying the URL, the model aliases,
 * and the usage-class contract.
 */
export const TRUSTED_PROVIDER_PRESETS: Readonly<
  Record<
    string,
    TrustedProviderPreset
  >
> = {
  /**
   * OpenRouter — meta-provider routing to 400+ models through a single
   * OpenAI-compatible endpoint. Unlike vendor-specific presets, OpenRouter
   * does NOT have a fixed model list — users should add model IDs from
   * OpenRouter's catalog (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4`,
   * `google/gemini-2.0-flash-001`) via the model management UI or config.
   *
   * The models listed below are recommended starters for the model picker;
   * users can add any OpenRouter model id at any time.
   * https://openrouter.ai/models — full catalog
   */
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter (Metered)',
    family: 'openai-compatible',
    // The OpenAI SDK default base URL — OpenRouter also accepts /v1 at
    // https://openrouter.ai/api/v1 for backward compatibility.
    baseUrl: 'https://openrouter.ai/api/v1',
    envVars: ['OPENROUTER_API_KEY'],
    // Recommended starter models — the full OpenRouter catalog (400+) is
    // available by adding model IDs in the format `provider/model-name`.
    // Users should add others to match their subscription and use case.
    models: [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4-20250514',
      'google/gemini-2.0-flash-001',
      'meta-llama/llama-4-scout',
      'deepseek/deepseek-chat',
    ],
    usage: 'metered-api',
    docsUrl: 'https://openrouter.ai/docs/quickstart',
  },

  /**
   * Kimi Code subscription — personal interactive coding via the official
   * Kimi Code Console API key. Endpoint and aliases documented by Moonshot
   * for generic coding-agent integration.
   * https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html
   */
  'kimi-for-coding': {
    id: 'kimi-for-coding',
    name: 'Kimi Code (Subscription)',
    family: 'openai-compatible',
    baseUrl: 'https://api.kimi.com/coding/v1',
    envVars: ['KIMI_API_KEY'],
    models: ['kimi-for-coding', 'kimi-for-coding-highspeed'],
    // Both K2.7 aliases stream chain-of-thought as `delta.reasoning_content`
    // which the OpenAI adapter already routes to the thinking channel; we
    // still pass `kimi-toggle` so a disabled-thinking attempt emits the
    // documented `thinking: { type: 'disabled' }` shape instead of dropping
    // the field entirely.
    quirks: { thinkingParam: 'kimi-toggle' },
    usage: 'subscription-interactive',
    docsUrl: 'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
  },

  /**
   * Moonshot Platform (metered) — separate from Kimi Code subscription.
   * Distinct credentials (MOONSHOT_API_KEY) and endpoint; subscription
   * terms do not cover automation/commercial usage, so we expose the
   * metered product for those callers.
   * https://platform.kimi.ai/docs/api/overview
   */
  moonshotai: {
    id: 'moonshotai',
    name: 'Moonshot Platform (Metered)',
    family: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    envVars: ['MOONSHOT_API_KEY'],
    models: ['kimi-k2.7-code', 'kimi-k2.7-code-highspeed'],
    // K2.7 code is always-thinking and rejects an explicit `disabled`
    // field; the existing `always-on` quirk suppresses the disable attempt.
    quirks: { thinkingParam: 'always-on' },
    usage: 'metered-api',
    docsUrl: 'https://platform.kimi.ai/docs/api/overview',
  },

  /**
   * Z.AI Coding Plan — subscription plan for interactive coding with GLM
   * models. Users subscribe at z.ai, generate an API key from their Coding
   * Plan dashboard, and paste it here. Uses the dedicated Coding Plan
   * endpoint (api.z.ai/api/coding/paas/v4) so requests draw from the
   * subscription quota, not pay-as-you-go billing.
   * https://docs.z.ai/devpack/quick-start
   */
  'zai-coding-plan': {
    id: 'zai-coding-plan',
    name: 'Z.AI Coding Plan (Subscription)',
    family: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    envVars: ['ZHIPU_API_KEY'],
    models: ['glm-5.2', 'glm-5-turbo', 'glm-4.7'],
    quirks: { thinkingParam: 'zai-glm' },
    usage: 'subscription-interactive',
    docsUrl: 'https://docs.z.ai/devpack/quick-start',
  },

  /**
   * Z.AI general pay-as-you-go API — metered. Separate from the Coding
   * Plan subscription; uses a distinct API key and draws from pay-as-you-go
   * quota.
   * https://docs.z.ai/guides/overview/quick-start
   */
  zai: {
    id: 'zai',
    name: 'Z.AI API (Metered)',
    family: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    envVars: ['ZHIPU_API_KEY'],
    models: ['glm-4.7', 'glm-5-turbo', 'glm-5.2'],
    quirks: { thinkingParam: 'zai-glm' },
    usage: 'metered-api',
    docsUrl: 'https://docs.z.ai/guides/overview/quick-start',
  },

  /**
   * MiniMax Token Plan — subscription plan offering access to MiniMax's
   * latest models including frontier coding, 1M context, and multimodal.
   * Users subscribe at platform.minimax.io and generate a plan API key.
   * https://platform.minimax.io/subscribe/token-plan
   */
  minimax: {
    id: 'minimax',
    name: 'MiniMax Token Plan (Subscription)',
    family: 'openai-compatible',
    baseUrl: 'https://api.minimax.io/v1',
    envVars: ['MINIMAX_API_KEY'],
    models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2'],
    usage: 'subscription-interactive',
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-chat-openai',
  },

  /**
   * DeepSeek API — metered pay-as-you-go inference via api.deepseek.com.
   * OpenAI-format chat completions endpoint with native reasoning/thinking
   * support (deepseek-v4-flash can toggle between thinking and non-thinking
   * modes; deepseek-v4-pro is always-thinking). The OpenAI adapter already
   * routes `delta.reasoning_content` to the thinking channel and echoes
   * `reasoning_content` on assistant messages — no special quirks needed.
   * https://api-docs.deepseek.com/
   */
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek API (Metered)',
    family: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    envVars: ['DEEPSEEK_API_KEY'],
    // V4 Flash supports both non-thinking and thinking (default); V4 Pro is
    // always-thinking. The deprecated `deepseek-chat` and `deepseek-reasoner`
    // aliases still resolve until 2026-07-24 per the deprecation notice.
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    usage: 'metered-api',
    docsUrl: 'https://api-docs.deepseek.com/',
  },

  /**
   * GroqCloud — ultra-fast inference via LPU hardware, served through an
   * OpenAI-compatible API endpoint. Runs leading open-weight models (Llama,
   * Mixtral, Gemma, Qwen) at industry-leading speeds. Supports tool calling,
   * streaming, JSON mode, and reasoning (Qwen3, GROK OSS models).
   * https://console.groq.com/docs/api-reference
   */
  groq: {
    id: 'groq',
    name: 'GroqCloud (Metered)',
    family: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    envVars: ['GROQ_API_KEY'],
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    usage: 'metered-api',
    docsUrl: 'https://console.groq.com/docs/api-reference',
  },

  /**
   * Perplexity Sonar API — metered API for web-augmented and standard chat
   * models. Sonar models have built-in web search with citation support.
   * OpenAI-format chat completions endpoint; sonar-reasoning models expose
   * chain-of-thought. The standard OpenAI adapter handles all wire formats.
   * https://docs.perplexity.ai/
   */
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity Sonar API (Metered)',
    family: 'openai-compatible',
    baseUrl: 'https://api.perplexity.ai',
    envVars: ['PERPLEXITY_API_KEY'],
    models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'],
    usage: 'metered-api',
    docsUrl: 'https://docs.perplexity.ai/',
  },
};

const PRESET_IDS = Object.keys(TRUSTED_PROVIDER_PRESETS);

/**
 * Look up a trusted preset by provider id. Returns `undefined` for ids
 * that are not in the trusted table (the generic openai-compatible /
 * anthropic / google path still works for those — see
 * `buildProviderFactoriesFromRegistry`).
 */
export function getTrustedProviderPreset(id: string): TrustedProviderPreset | undefined {
  return TRUSTED_PROVIDER_PRESETS[id];
}

/**
 * List all trusted preset ids. Used by the WebUI `providers.json` and the
 * TUI auth menu to render curated cards in addition to the user-managed
 * providers.
 */
export function listTrustedProviderPresetIds(): string[] {
  return [...PRESET_IDS];
}

/**
 * Build a fresh `ProviderConfig` from a trusted preset, optionally
 * layering an initial API key. The returned object owns its own
 * `customModels`/`models`/`envVars` arrays/maps — callers may mutate
 * freely without affecting the preset table.
 *
 * Notes:
 *  - `type` is set to the preset id so the registry can resolve the
 *    catalog entry by id. When the user picks a custom alias (e.g.
 *    `my-kimi`), callers should set `cfg.type = preset.id` and `cfg.family`
 *    explicitly (or use `buildProviderConfigForAlias`).
 *  - `apiKey` / `apiKeys[]` are not initialised here — callers use the
 *    normal key-write path so the vault encryption flow stays uniform.
 */
export function buildProviderConfigFromPreset(preset: TrustedProviderPreset): ProviderConfig {
  const cfg: ProviderConfig = {
    type: preset.id,
    family: preset.family,
    baseUrl: preset.baseUrl,
    envVars: [...preset.envVars],
    models: [...preset.models],
  };
  if (preset.customModels) {
    cfg.customModels = {};
    for (const [id, def] of Object.entries(preset.customModels)) {
      cfg.customModels[id] = { ...def };
    }
  }
  if (preset.quirks) {
    cfg.quirks = { ...preset.quirks };
  }
  return cfg;
}

/**
 * Resolve a user-supplied alias against the trusted preset table. Returns
 * the preset when the alias matches a canonical id exactly or when the
 * alias follows the `<id>-<customSuffix>` convention (so a user can save
 * a second Kimi subscription key under `kimi-for-coding-work` without
 * losing the canonical defaults). Returns `undefined` for unknown aliases
 * so the generic registration path can take over.
 */
export function resolvePresetForAlias(alias: string): TrustedProviderPreset | undefined {
  if (TRUSTED_PROVIDER_PRESETS[alias]) return TRUSTED_PROVIDER_PRESETS[alias];
  // Match the longest known prefix so a custom suffix does not steal the
  // canonical preset (e.g. `kimi-for-coding-work` → `kimi-for-coding`).
  let bestMatch: TrustedProviderPreset | undefined;
  for (const preset of Object.values(TRUSTED_PROVIDER_PRESETS)) {
    if (!alias.startsWith(`${preset.id}-`)) continue;
    if (!bestMatch || preset.id.length > bestMatch.id.length) bestMatch = preset;
  }
  return bestMatch;
}

/**
 * True when an id matches a trusted preset exactly. Used by the WebUI
 * setup-card UI to decide whether to send a trusted preset id (and rely
 * on server-side hydration) or a generic id.
 */
export function isTrustedProviderId(id: string): boolean {
  return TRUSTED_PROVIDER_PRESETS[id] !== undefined;
}