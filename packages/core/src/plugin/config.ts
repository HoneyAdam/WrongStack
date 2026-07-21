import type { Config, PluginConfig } from '../types/config.js';
import type {
  Plugin,
  PluginConfigFieldLifecycle,
  PluginConfigFieldMetadata,
} from '../types/plugin.js';

export interface ResolvePluginConfigInput {
  name: string;
  aliases?: readonly string[] | undefined;
  defaults?: Readonly<Record<string, unknown>> | undefined;
  config?: Partial<Pick<Config, 'plugins' | 'extensions'>> | undefined;
  /** Highest-precedence host override, primarily for embedding APIs. */
  explicitOptions?: Readonly<Record<string, unknown>> | undefined;
}

export type PluginConfigSource =
  | 'legacy-plugin-map'
  | 'plugin-entry'
  | 'extension'
  | 'explicit-options';

export interface ResolvedPluginConfig {
  options: Record<string, unknown>;
  configured: boolean;
  sources: PluginConfigSource[];
}

export interface PluginConfigChange {
  key: string;
  lifecycle: PluginConfigFieldLifecycle;
  secret: boolean;
  previous: unknown;
  next: unknown;
}

/**
 * Resolve one plugin namespace with a single shallow precedence rule:
 * defaults < legacy plugin map < ordered plugin entries < aliases/canonical
 * extension namespaces < explicit host options. Canonical extension names
 * beat aliases, making migrations deterministic regardless of object order.
 */
export function resolvePluginConfig(input: ResolvePluginConfigInput): ResolvedPluginConfig {
  const names = [...new Set([...(input.aliases ?? []), input.name])];
  const options: Record<string, unknown> = { ...(input.defaults ?? {}) };
  const sources: PluginConfigSource[] = [];
  let configured = false;
  const merge = (value: unknown, source: PluginConfigSource): void => {
    if (!isRecord(value)) return;
    Object.assign(options, value);
    configured = true;
    if (!sources.includes(source)) sources.push(source);
  };

  const plugins = input.config?.plugins as unknown;
  if (isRecord(plugins)) {
    for (const name of names) merge(plugins[name], 'legacy-plugin-map');
  } else if (Array.isArray(plugins)) {
    for (const candidate of plugins) {
      if (!isPluginEntry(candidate) || !names.includes(candidate.name)) continue;
      merge(candidate.options, 'plugin-entry');
    }
  }

  const extensions = input.config?.extensions;
  for (const name of names) merge(extensions?.[name], 'extension');
  merge(input.explicitOptions, 'explicit-options');

  return { options, configured, sources };
}

export function resolvePluginManifestConfig(
  plugin: Pick<Plugin, 'name' | 'configAliases' | 'defaultConfig'>,
  config?: ResolvePluginConfigInput['config'],
  explicitOptions?: Readonly<Record<string, unknown>>,
): ResolvedPluginConfig {
  return resolvePluginConfig({
    name: plugin.name,
    aliases: plugin.configAliases,
    defaults: plugin.defaultConfig,
    config,
    explicitOptions,
  });
}

/** Unknown fields are immutable by default so a new option cannot silently hot-reload. */
export function diffPluginConfig(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, PluginConfigFieldMetadata>>,
): PluginConfigChange[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changes: PluginConfigChange[] = [];
  for (const key of keys) {
    if (valuesEqual(previous[key], next[key])) continue;
    const metadata = fields[key];
    changes.push({
      key,
      lifecycle: metadata?.lifecycle ?? 'immutable',
      secret: metadata?.secret === true,
      previous: metadata?.secret === true ? '[REDACTED]' : previous[key],
      next: metadata?.secret === true ? '[REDACTED]' : next[key],
    });
  }
  return changes;
}

export function redactPluginConfig(
  options: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, PluginConfigFieldMetadata>>,
): Record<string, unknown> {
  const redacted = { ...options };
  for (const [key, metadata] of Object.entries(fields)) {
    if (metadata.secret === true && key in redacted) redacted[key] = '[REDACTED]';
  }
  return redacted;
}

/** Validate an opted-in metadata map against the manifest's schema/default keys. */
export function validatePluginConfigMetadata(
  plugin: Pick<Plugin, 'configFields' | 'configSchema' | 'defaultConfig'>,
): string[] {
  if (!plugin.configFields) return [];
  const declared = plugin.configFields;
  const expected = new Set([
    ...Object.keys(plugin.configSchema?.properties ?? {}),
    ...Object.keys(plugin.defaultConfig ?? {}),
  ]);
  const issues: string[] = [];
  for (const key of expected) {
    if (!declared[key]) issues.push(`missing configFields metadata for "${key}"`);
  }
  for (const [key, metadata] of Object.entries(declared)) {
    if (!['hot', 'restart', 'immutable'].includes(metadata.lifecycle)) {
      issues.push(`invalid lifecycle for configFields."${key}"`);
    }
  }
  return issues;
}

function isPluginEntry(value: unknown): value is PluginConfig {
  return isRecord(value) && typeof value['name'] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => key in right && valuesEqual(left[key], right[key]))
    );
  }
  return false;
}
