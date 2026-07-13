/* =========================================================================
   Provider gallery data. Mirrors real repo sources, NOT the full ~140 dynamic
   models.dev catalog (which is fetched at boot and has no static per-provider
   record). Keep these in sync with their sources:
   - curatedProviders  → packages/webui/public/providers.json
   - oauthProviders    → packages/core/src/models/models-registry.ts (FAMILY_BY_PROVIDER_ID)
                         + packages/providers/src/oauth/*
   - localProviders    → packages/cli/src/auth-menu/local-presets.ts (LOCAL_LLM_PRESETS)
   ========================================================================= */

export type WireFamily = 'anthropic' | 'openai' | 'openai-compatible' | 'google';

export const familyLabels: Record<WireFamily, string> = {
  anthropic: 'Anthropic wire',
  openai: 'OpenAI wire',
  'openai-compatible': 'OpenAI-compatible',
  google: 'Google wire',
};

export interface CuratedProvider {
  id: string;
  name: string;
  description: string;
  icon: string;
  family: WireFamily;
  keyPlaceholder: string;
  docsUrl: string;
}

/** The setup-screen quick-start providers shipped in the WebUI. */
export const curatedProviders: CuratedProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT, o-series, and Codex models.',
    icon: '🤖',
    family: 'openai',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude model access over the native Messages API.',
    icon: '🧠',
    family: 'anthropic',
    keyPlaceholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Gemini Pro, Flash, and Nano.',
    icon: '✨',
    family: 'google',
    keyPlaceholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'High-performance reasoning at low cost.',
    icon: '🐋',
    family: 'openai-compatible',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Reach many model vendors through one aggregated key.',
    icon: '🔀',
    family: 'openai-compatible',
    keyPlaceholder: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description:
      'One subscription for frontier coding, 1M ultra-long context and native multimodal models on a shared quota.',
    icon: '🔮',
    family: 'openai-compatible',
    keyPlaceholder: 'eyJ...',
    docsUrl: 'https://platform.minimax.io/',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    description: 'Moonshot AI long-context models.',
    icon: '🌙',
    family: 'openai-compatible',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://www.kimi.com/membership/pricing',
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM)',
    description: 'GLM coding-plan access with broad tool compatibility.',
    icon: '🔷',
    family: 'openai-compatible',
    keyPlaceholder: '...',
    docsUrl: 'https://z.ai/',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: 'Global hosted API fronting many LLM providers from US, EU and Singapore regions.',
    icon: '🌍',
    family: 'openai-compatible',
    keyPlaceholder: 'oc-...',
    docsUrl: 'https://opencode.ai/',
  },
];

export interface OAuthProvider {
  id: string;
  name: string;
  description: string;
  command: string;
}

/** First-class subscription providers authenticated through a browser/device flow. */
export const oauthProviders: OAuthProvider[] = [
  {
    id: 'openai-codex',
    name: 'ChatGPT (Codex)',
    description: 'Use ChatGPT Codex subscription access after a single browser sign-in.',
    command: 'wstack auth login chatgpt',
  },
  {
    id: 'anthropic-oauth',
    name: 'Claude Pro / Max',
    description: 'Vendor OAuth flow with an encrypted, self-refreshing token in the local vault.',
    command: 'wstack auth login claude',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    description: 'GitHub device flow with self-refreshing access to Copilot chat models.',
    command: 'wstack auth login copilot',
  },
];

export interface LocalProvider {
  id: string;
  name: string;
  baseUrl: string;
  noAuth: boolean;
  hint: string;
}

/** Local / self-hosted OpenAI-compatible runtimes from the auth picker. */
export const localProviders: LocalProvider[] = [
  {
    id: 'omniroute',
    name: 'OmniRoute',
    baseUrl: 'http://localhost:20128/v1',
    noAuth: true,
    hint: 'WrongStack local gateway — auto-discovers models, no auth.',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    noAuth: true,
    hint: 'Local model runner on port 11434, no auth.',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://localhost:8000/v1',
    noAuth: false,
    hint: 'High-throughput server on port 8000, optional Bearer.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    noAuth: false,
    hint: 'Desktop model host on port 1234, optional Bearer.',
  },
];
