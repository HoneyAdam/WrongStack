import type { CustomModelDefinition, WireFamily } from '@wrongstack/core/types';
import type { CompatibilityQuirks } from './compatibility-quirks.js';

export type ProviderUsage =
  | 'metered-api'
  | 'subscription-interactive'
  | 'subscription-team'
  | 'local';

export type OpenAICompatiblePolicyId =
  | 'openrouter'
  | 'deepseek'
  | 'kimi'
  | 'zai'
  | 'alibaba'
  | 'xai'
  | 'groq'
  | 'perplexity';

export interface ProviderReferral {
  code: string;
  reward: string;
  url: string;
}

/** Presentation metadata kept beside, but separate from, runtime facts. */
export interface ProviderCatalogMetadata {
  description: string;
  icon: string;
  color: string;
  keyPlaceholder: string;
  referral?: ProviderReferral;
}

/**
 * Canonical provider product definition. Hosts consume projections of this
 * shape instead of maintaining their own provider tables.
 */
export interface ProviderDefinition {
  id: string;
  name: string;
  family: WireFamily;
  baseUrl?: string;
  envVars: readonly string[];
  models: readonly string[];
  usage: ProviderUsage;
  docsUrl?: string;
  customModels?: Readonly<Record<string, CustomModelDefinition>>;
  quirks?: CompatibilityQuirks;
  autoDiscover?: boolean;
  requestPolicy?: OpenAICompatiblePolicyId;
  catalog?: ProviderCatalogMetadata;
  local?: {
    noAuth: boolean;
    hint: string;
  };
}
