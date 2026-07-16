// ---------------------------------------------------------------------------
// P2.1 — Unified plugin enablement view.
//
// The CLI owns the canonical plugin state in `Config.plugins`
// (configured via `wstack plugin add | enable | disable | toggle`).
// The WebUI stores a per-browser override in `localPrefs.pluginsEnabled`
// so the toggle UI can show useful state when the WS bridge is offline.
//
// This module is the single read-side join: given the canonical config
// (server-driven) and the local override map, produce the resolved
// "is this plugin enabled right now" boolean the Settings UI renders.
//
// Write-side stays where it already lives — `localPrefs.set` for the
// local override and `wstack plugin toggle <name>` (via
// `runPluginManagementCommand`) for the canonical state. We do not
// silently mutate either from this view layer; the toggle UI calls both.
// ---------------------------------------------------------------------------

import type { PluginConfig } from '@wrongstack/core';

type PluginEntry = string | PluginConfig;

export interface ResolvedPluginState {
  /** Plugin name as it appears in `Config.plugins`. */
  readonly name: string;
  /** True iff the canonical config says this plugin is enabled. */
  readonly configuredEnabled: boolean;
  /**
   * `undefined` if the user has not overridden the plugin locally
   * (and the toggle UI should show the canonical value).
   * `true`/`false` if the user pinned an explicit local state.
   */
  readonly localOverride: boolean | undefined;
  /**
   * The resolved enablement used by the UI: local override wins when
   * the user pinned one, otherwise the canonical config decides.
   */
  readonly resolved: boolean;
}

/** True iff the plugin entry is disabled in the canonical config. */
function isPluginEntryDisabled(entry: PluginEntry): boolean {
  return typeof entry === 'object' && entry.enabled === false;
}

/** Strip the `PluginConfig` wrapper to the canonical plugin name. */
function pluginNameOf(entry: PluginEntry): string {
  return typeof entry === 'string' ? entry : entry.name;
}

/**
 * Resolve the effective enablement of every plugin in the canonical list.
 *
 * `configuredPlugins` defaults to `[]` so a missing server payload
 * degrades to "all enabled" rather than throwing — a SafeBy default that
 * matches the WebUI's prior `localPrefs.pluginsEnabled?.[name] ?? true`
 * behaviour. The local override map may be missing, in which case only
 * the canonical config is consulted.
 */
export function resolvePluginEnablement(
  configuredPlugins: readonly PluginEntry[] | undefined,
  localOverrides: Readonly<Record<string, boolean>> | undefined,
): ResolvedPluginState[] {
  if (!configuredPlugins || configuredPlugins.length === 0) return [];
  const out: ResolvedPluginState[] = [];
  for (const entry of configuredPlugins) {
    const name = pluginNameOf(entry);
    const configuredEnabled = !isPluginEntryDisabled(entry);
    const localOverride = localOverrides?.[name];
    const resolved = localOverride ?? configuredEnabled;
    out.push({ name, configuredEnabled, localOverride, resolved });
  }
  return out;
}

/**
 * Convenience accessor for callers that only need one plugin's resolved
 * state. Returns `undefined` if the plugin is not configured at all
 * (the toggle UI should treat that as "managed out — not in this list").
 */
export function resolveOnePlugin(
  configuredPlugins: readonly PluginEntry[] | undefined,
  localOverrides: Readonly<Record<string, boolean>> | undefined,
  name: string,
): ResolvedPluginState | undefined {
  const all = resolvePluginEnablement(configuredPlugins, localOverrides);
  return all.find((p) => p.name === name);
}
