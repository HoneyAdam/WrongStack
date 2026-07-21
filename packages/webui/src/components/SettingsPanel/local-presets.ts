import { projectLocalProviderPresets } from '@wrongstack/providers/definitions';

export type { LocalProviderPresetProjection as LocalServerPreset } from '@wrongstack/providers/definitions';
export const LOCAL_PRESET_FAMILY = 'openai-compatible';
export const LOCAL_SERVER_PRESETS = projectLocalProviderPresets();
