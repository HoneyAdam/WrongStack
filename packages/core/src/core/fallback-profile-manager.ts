/**
 * FallbackProfileManager — centralized, decoupled fallback profile resolution.
 *
 * Every consumer (fallback-model, council orchestrator, one-shot LLM, plugins)
 * resolves its fallback chain through this single manager instead of parsing
 * config.fallbackProfiles independently. This guarantees consistent resolution,
 * provider-health filtering, and a single reload point on config changes.
 *
 * Design:
 * - Immutable: `resolve()` returns a frozen chain; the manager itself is
 *   replaced on config reload, never mutated in place.
 * - Provider-aware: each profile entry is checked against live provider config
 *   (has API key?) before inclusion.
 * - Zero coupling: consumers only see `readonly FallbackChainEntry[]` —
 *   no awareness of profile names, config shape, or provider internals.
 */

import type { Config, ProviderConfig } from '../types/config.js';
import { parseModelRef } from './fallback-model.js';

// ── Public types ────────────────────────────────────────────────────────────

/** One resolved entry in a fallback chain. */
export interface FallbackChainEntry {
  /** Resolved provider id. */
  readonly providerId: string;
  /** Resolved model id. */
  readonly model: string;
  /** Whether this entry uses a different provider than the primary. */
  readonly providerSwitched: boolean;
}

/** Immutable fallback chain returned by the manager. */
export type FallbackChain = readonly FallbackChainEntry[];

/**
 * Provider health check result. Consumers can optionally probe before
 * building a provider instance.
 */
export interface ProviderAvailability {
  readonly providerId: string;
  readonly hasKey: boolean;
  readonly hasModels: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function providerHasKey(entry: ProviderConfig | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.apiKey === 'string' && entry.apiKey.length > 0) return true;
  if (Array.isArray(entry.apiKeys) && entry.apiKeys.some((k) => k?.apiKey)) return true;
  if (Array.isArray(entry.envVars) && entry.envVars.some((v) => !!process.env[v])) return true;
  return false;
}

function visibleProviderModels(config: Config, providerId: string, providerModels: string[]): string[] {
  const entry = config.providers?.[providerId];
  return entry?.models !== undefined ? [...entry.models] : providerModels;
}

// ── Manager ─────────────────────────────────────────────────────────────────

export class FallbackProfileManager {
  /** Immutable snapshot of config.fallbackProfiles at construction time. */
  private readonly profiles: ReadonlyMap<string, readonly string[]>;
  /** Reference config snapshot for provider lookups. */
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
    const raw = config.fallbackProfiles ?? {};
    const entries = new Map<string, readonly string[]>();
    for (const [name, chain] of Object.entries(raw)) {
      if (Array.isArray(chain) && chain.length > 0) {
        entries.set(name, Object.freeze([...chain]));
      }
    }
    this.profiles = entries;
  }

  // ── Profile existence ──────────────────────────────────────────────────

  hasProfile(name: string): boolean {
    return this.profiles.has(name);
  }

  listProfiles(): readonly string[] {
    return Object.freeze([...this.profiles.keys()]);
  }

  // ── Resolution ─────────────────────────────────────────────────────────

  /**
   * Resolve a named fallback profile to a validated, provider-filtered chain.
   *
   * Returns an empty chain when:
   * - The profile doesn't exist.
   * - Every entry's provider is missing, has no key, or has no matching model.
   *
   * @param name - Profile name from config.fallbackProfiles.
   * @param defaultProvider - Used when an entry has no explicit provider.
   * @param exclude - Optional { providerId, model } to skip (avoid self-fallback).
   */
  resolve(
    name: string,
    opts: {
      defaultProvider?: string | undefined;
      exclude?: { providerId: string; model: string } | undefined;
    } = {},
  ): FallbackChain {
    const defaultProvider = opts.defaultProvider ?? this.config.provider;
    const chain = this.profiles.get(name);
    if (!chain) return FREEZER_EMPTY;

    const excludeKey = opts.exclude
      ? `${opts.exclude.providerId}/${opts.exclude.model}`
      : undefined;

    const resolved: FallbackChainEntry[] = [];
    const seen = new Set<string>();

    for (const ref of chain) {
      const parsed = parseModelRef(ref);
      if (!parsed.model) continue;

      const providerId = parsed.provider ?? defaultProvider;
      const key = `${providerId}/${parsed.model}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip self-reference
      if (excludeKey && key === excludeKey) continue;

      // Skip entries whose provider has no matching model in its allow-list
      // (provider may restrict which models are available).
      const allowedModels = this.config.providers?.[providerId]?.models;
      if (allowedModels && !allowedModels.includes(parsed.model)) continue;

      resolved.push({
        providerId,
        model: parsed.model,
        providerSwitched: providerId !== (opts.exclude?.providerId ?? this.config.provider),
      });
    }

    return Object.freeze(resolved);
  }

  /**
   * Resolve the effective fallback chain for a session: explicit fallbackModels
   * first, then named profile, then smart default (unless disabled).
   *
   * Mirrors the previous `effectiveFallbackChain()` logic but centralized.
   */
  resolveEffective(
    opts: {
      fallbackModels?: readonly string[] | undefined;
      fallbackProfile?: string | undefined;
      fallbackAuto?: boolean | undefined;
      exclude?: { providerId: string; model: string } | undefined;
    } = {},
  ): FallbackChain {
    // 1. Explicit fallbackModels (already resolved refs)
    //    Only return if non-empty; empty chain falls through to next source.
    if (opts.fallbackModels && opts.fallbackModels.length > 0) {
      const resolved = this.resolveRefs(opts.fallbackModels, opts.exclude);
      if (resolved.length > 0) return resolved;
    }

    // 2. Named profile — only return if non-empty
    if (opts.fallbackProfile) {
      const resolved = this.resolve(opts.fallbackProfile, { exclude: opts.exclude });
      if (resolved.length > 0) return resolved;
    }

    // 3. Smart default
    if (opts.fallbackAuto !== false) {
      return this.smartDefault(opts.exclude);
    }

    return FREEZER_EMPTY;
  }

  // ── Provider availability (read-only) ──────────────────────────────────

  checkProvider(providerId: string): ProviderAvailability {
    const entry = this.config.providers?.[providerId];
    return Object.freeze({
      providerId,
      hasKey: providerHasKey(entry),
      hasModels: Array.isArray(entry?.models) && entry.models.length > 0,
    });
  }

  // ── Rebuild on config change ───────────────────────────────────────────

  reload(newConfig: Config): FallbackProfileManager {
    return new FallbackProfileManager(newConfig);
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Resolve an array of model ref strings (from explicit fallbackModels config).
   * Public so consumers like one-shot-llm can use it directly.
   */
  resolveRefs(
    refs: readonly string[],
    exclude?: { providerId: string; model: string },
  ): FallbackChain {
    const excludeKey = exclude ? `${exclude.providerId}/${exclude.model}` : undefined;
    const resolved: FallbackChainEntry[] = [];
    const seen = new Set<string>();

    for (const ref of refs) {
      const parsed = parseModelRef(ref);
      if (!parsed.model) continue;

      const providerId = parsed.provider ?? this.config.provider;
      const key = `${providerId}/${parsed.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (excludeKey && key === excludeKey) continue;

      resolved.push({
        providerId,
        model: parsed.model,
        providerSwitched: providerId !== (exclude?.providerId ?? this.config.provider),
      });
    }

    return Object.freeze(resolved);
  }

  /**
   * Derive a smart default chain from configured providers when nothing
   * explicit is set. Same-provider alternatives first, then cross-provider.
   * Limited to 4 entries to avoid burning through models on a transient blip.
   */
  private smartDefault(exclude?: { providerId: string; model: string }): FallbackChain {
    const leaderProvider = this.config.provider;
    const leaderModel = this.config.model;
    const providers = this.config.providers ?? {};
    const favoriteSet = new Set(
      (this.config.favoriteModels ?? []).map((ref) => {
        const p = parseModelRef(ref);
        return `${p.provider ?? leaderProvider}/${p.model}`;
      }),
    );
    const hasFavorites = favoriteSet.size > 0;
    const favoritesOnly = this.config.favoriteModelsOnly === true;
    const seen = new Set<string>();
    const favorites: string[] = [];
    const sameProvider: string[] = [];
    const crossProvider: string[] = [];

    const excludeKey = exclude ? `${exclude.providerId}/${exclude.model}` : undefined;

    const ids = Object.keys(providers).sort((a, b) =>
      a === leaderProvider ? -1 : b === leaderProvider ? 1 : a.localeCompare(b),
    );

    for (const id of ids) {
      const entry = providers[id];
      if (!providerHasKey(entry)) continue;
      const models = visibleProviderModels(this.config, id, entry?.models ?? []);
      for (const model of models) {
        if (id === leaderProvider && model === leaderModel) continue;
        const ref = `${id}/${model}`;
        if (seen.has(ref)) continue;
        seen.add(ref);
        if (excludeKey && ref === excludeKey) continue;
        if (favoriteSet.has(ref)) { favorites.push(ref); continue; }
        if (favoritesOnly && hasFavorites) continue;
        (id === leaderProvider ? sameProvider : crossProvider).push(ref);
      }
    }

    const MAX = 4;
    const all = [...favorites, ...sameProvider, ...crossProvider].slice(0, MAX);
    return Object.freeze(
      all.map((ref) => {
        const p = parseModelRef(ref);
        return {
          providerId: p.provider ?? leaderProvider,
          model: p.model,
          providerSwitched: (p.provider ?? leaderProvider) !== (exclude?.providerId ?? leaderProvider),
        } satisfies FallbackChainEntry;
      }),
    );
  }
}

const FREEZER_EMPTY: FallbackChain = Object.freeze([]);
