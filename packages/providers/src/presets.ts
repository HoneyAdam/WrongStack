/**
 * Provider presets were removed in favor of runtime resolution via
 * `ModelsRegistry` (models.dev). This module remains for backwards-compatible
 * imports and lists no entries.
 *
 * @deprecated Use `ModelsRegistry.listProviders()` instead.
 */
export const PRESETS: Record<string, never> = {};
export function listPresets(): string[] {
  return [];
}
export type PresetSpec = never;
