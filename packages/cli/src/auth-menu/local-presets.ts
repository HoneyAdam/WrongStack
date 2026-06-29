/**
 * Local-LLM server presets — the single source of truth shared by the
 * `wstack auth local` quick-add flow (`./local.ts`) and the startup
 * provider picker (`../picker.ts`).
 *
 * This module holds ONLY the preset data + its type, with no runtime
 * dependencies (no probe, no config vault). That lets the picker import
 * the presets to surface keyless local gateways without dragging in the
 * heavier auth-flow machinery. Keep these entries in sync with the
 * wire-format presets in `@wrongstack/providers`.
 */

export interface LocalLlmPresetEntry {
  /** Stable id used both for the config key and the --name flag. */
  id: string;
  /** Display name shown in the picker. */
  label: string;
  /** Default base URL for this server. */
  defaultBaseUrl: string;
  /**
   * When true, no API key is needed — the shortcut saves the provider
   * without prompting for a key. Use for servers that reject any
   * Authorization header (Ollama).
   */
  noAuth: boolean;
  /**
   * Human-readable hint shown next to the entry — typically the upstream
   * doc URL or the local port.
   */
  hint: string;
}

/**
 * Single source of truth for the `wstack auth local` picker. Keep this
 * in sync with the wire-format presets in `@wrongstack/providers`.
 */
export const LOCAL_LLM_PRESETS: readonly LocalLlmPresetEntry[] = [
  {
    id: 'omniroute',
    label: 'OmniRoute',
    defaultBaseUrl: 'http://localhost:20128/v1',
    noAuth: true,
    hint: 'WrongStack local gateway — port 20128, no auth, auto-discovers models',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    noAuth: true,
    hint: 'https://ollama.com — port 11434, no auth',
  },
  {
    id: 'vllm',
    label: 'vLLM',
    defaultBaseUrl: 'http://localhost:8000/v1',
    noAuth: false,
    hint: 'https://docs.vllm.ai — port 8000, optional Bearer',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    defaultBaseUrl: 'http://localhost:1234/v1',
    noAuth: false,
    hint: 'https://lmstudio.ai — port 1234, optional Bearer',
  },
] as const;
