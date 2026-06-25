/**
 * Shared provider-config helpers used by the picker, main boot sequence,
 * and subcommands. Keeps provider key detection and alias resolution in
 * one place so the logic doesn't drift between call sites.
 */
import type { Config, ModelsRegistry, ProviderConfig, ResolvedProvider } from '@wrongstack/core';

/** Return the provider's visible model ids. When `cfg.models` is defined, it is
 * the allowlist; otherwise the catalog/default list is used. */
export function visibleModelIds(
  providerId: string,
  config: Config,
  catalogModelIds: string[],
  cfg?: ProviderConfig | undefined,
): string[] {
  const entry = cfg ?? config.providers?.[providerId];
  return entry?.models !== undefined ? [...entry.models] : [...catalogModelIds];
}

/**
 * Does this provider have an API key available — either in the
 * environment (via one of its known env vars) or stored in config
 * (encrypted or plaintext)? Used to filter the picker to providers
 * the user can actually use right now.
 */
export function hasApiKey(provider: ResolvedProvider, config?: Config): boolean {
  if (provider.envVars.some((v) => !!process.env[v])) return true;
  const entry = config?.providers?.[provider.id];
  if (!entry) return false;
  if (typeof entry.apiKey === 'string' && entry.apiKey.length > 0) return true;
  if (Array.isArray(entry.apiKeys) && entry.apiKeys.some((k) => k?.apiKey)) return true;
  return false;
}

/**
 * Build the list of providers the user can switch to mid-session.
 * Only includes providers that have an API key available (env var or
 * stored config). Falls back to the full catalog when no keys are found.
 *
 * Models are inlined from the catalog (or from `cfg.models` for custom
 * entries) so the picker can show a real selection.
 */
export async function buildPickableProviders(
  modelsRegistry: ModelsRegistry,
  config: Config,
): Promise<Array<{ id: string; family: string; models: string[] }>> {
  const overlay = config.providers ?? {};
  let catalog: Awaited<ReturnType<typeof modelsRegistry.listProviders>> = [];
  try {
    catalog = await modelsRegistry.listProviders();
  } catch {
    // catalog unavailable — keyed-by-config-only path still works
  }
  const catalogById = new Map(catalog.map((p) => [p.id, p]));
  const hasKey = (id: string): boolean => {
    const entry = overlay[id];
    const envHit = catalogById.get(id)?.envVars.some((v) => !!process.env[v]);
    if (envHit) return true;
    if (!entry) return false;
    if (typeof entry.apiKey === 'string' && entry.apiKey.length > 0) return true;
    if (Array.isArray(entry.apiKeys) && entry.apiKeys.some((k) => k?.apiKey)) return true;
    return false;
  };
  const seen = new Set<string>();
  const out: Array<{ id: string; family: string; models: string[] }> = [];
  for (const [id, cfg] of Object.entries(overlay)) {
    if (!hasKey(id)) continue;
    seen.add(id);
    const catalogType = cfg.type && cfg.type !== id ? cfg.type : id;
    const inherited = catalogById.get(catalogType);
    const family = cfg.family ?? inherited?.family ?? 'unsupported';
    if (family === 'unsupported') continue;
    const models = visibleModelIds(id, config, (inherited?.models ?? []).map((m) => m.id), cfg);
    out.push({ id, family, models });
  }
  for (const p of catalog) {
    if (seen.has(p.id)) continue;
    if (p.family === 'unsupported') continue;
    if (!hasKey(p.id)) continue;
    out.push({ id: p.id, family: p.family, models: p.models.map((m) => m.id) });
  }
  return out;
}

/**
 * Resolve a provider id that may be an alias. When the user has
 * `providers[id].type` pointing at a different catalog entry, return
 * the catalog id so downstream lookups still work. Returns the
 * original id unchanged when it's a direct catalog match.
 */
export function resolveProviderAlias(providerId: string, config: Config): string {
  const savedAlias = config.providers?.[providerId];
  if (savedAlias?.type && savedAlias.type !== providerId) {
    return savedAlias.type;
  }
  return providerId;
}
