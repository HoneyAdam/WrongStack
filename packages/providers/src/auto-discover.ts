import type { ModelsDevModel, ModelsDevProvider } from '@wrongstack/core';

/**
 * Auto-discovery of an OpenAI-compatible server's model catalog.
 *
 * Many proxy/gateway servers (omniroute, LiteLLM, vLLM, LM Studio, …) expose a
 * `/v1/models` endpoint that returns far richer metadata than the bare OpenAI
 * spec — per-model `capabilities`, `context_length`, `max_output_tokens`,
 * `input_modalities`, a display `name`, etc. This module fetches that list and
 * maps it onto a `ModelsDevProvider` so the discovered models flow through the
 * exact same registry path as catalog (models.dev) models: factories are built
 * for them and per-model `Capabilities` resolve automatically — no hand-entered
 * model lists or capability overrides required.
 *
 * The wire format is the OpenAI "list" object. We read the documented OpenAI
 * fields and the common extended fields; anything missing degrades to a sane
 * default rather than failing.
 */

/** One entry from a `/v1/models` response. Only the fields we read are typed. */
interface CompatibleModelEntry {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  max_input_tokens?: unknown;
  max_output_tokens?: unknown;
  /** OpenAI-spec field used by some servers in place of the extended ones. */
  max_tokens?: unknown;
  input_modalities?: unknown;
  output_modalities?: unknown;
  created?: unknown;
  capabilities?: {
    tool_calling?: unknown;
    tools?: unknown;
    reasoning?: unknown;
    thinking?: unknown;
    vision?: unknown;
    temperature?: unknown;
  };
}

export interface DiscoverOptions {
  /** Server base URL, e.g. `http://localhost:20128/v1`. */
  baseUrl: string;
  /** Bearer token. Some local servers accept any value; pass what you have. */
  apiKey?: string | undefined;
  /** Extra headers merged into the request. */
  headers?: Record<string, string> | undefined;
  /** Display name for the resulting provider (defaults to the id). */
  providerName?: string | undefined;
  /** Abort the fetch after this many ms (default 8000). 0 disables. */
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function asPosInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

/** Map one `/v1/models` entry to a `ModelsDevModel`. Returns undefined when the
 *  entry has no usable id. */
export function mapCompatibleModel(entry: CompatibleModelEntry): ModelsDevModel | undefined {
  const id = typeof entry.id === 'string' ? entry.id : undefined;
  if (!id) return undefined;
  const caps = entry.capabilities ?? {};
  const inputModalities = asStringArray(entry.input_modalities);
  const outputModalities = asStringArray(entry.output_modalities);
  // Prefer the explicit vision capability; fall back to an `image` input modality.
  const vision = asBool(caps.vision) || Boolean(inputModalities?.includes('image'));
  const context = asPosInt(entry.context_length) ?? asPosInt(entry.max_input_tokens);
  const output = asPosInt(entry.max_output_tokens) ?? asPosInt(entry.max_tokens);

  const model: ModelsDevModel = {
    id,
    name: typeof entry.name === 'string' && entry.name ? entry.name : id,
    tool_call: asBool(caps.tool_calling) || asBool(caps.tools),
    // omniroute splits these: `reasoning` (effort) and `thinking` (extended).
    // Either implies the model can reason for capability purposes.
    reasoning: asBool(caps.reasoning) || asBool(caps.thinking),
    temperature: asBool(caps.temperature),
  };
  if (inputModalities || outputModalities || vision) {
    const input = inputModalities ?? (vision ? ['text', 'image'] : ['text']);
    model.modalities = {
      input: vision && !input.includes('image') ? [...input, 'image'] : input,
      output: outputModalities ?? ['text'],
    };
  }
  if (context !== undefined || output !== undefined) {
    model.limit = {
      ...(context !== undefined ? { context } : {}),
      ...(output !== undefined ? { output } : {}),
    };
  }
  if (typeof entry.created === 'number' && entry.created > 0) {
    // ISO date helps the picker's newest-first sort.
    model.last_updated = new Date(entry.created * 1000).toISOString().slice(0, 10);
  }
  return model;
}

/**
 * Fetch and map a `/v1/models` listing into a `ModelsDevProvider`. Resolves to
 * `undefined` (never throws) on any network/parse/shape failure or an empty
 * list, so callers can treat discovery as best-effort and fall back to a cache.
 */
export async function discoverOpenAICompatibleModels(
  providerId: string,
  opts: DiscoverOptions,
): Promise<ModelsDevProvider | undefined> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const url = /\/v\d+$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        ...opts.headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: unknown } | unknown;
    const list = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown })?.data)
        ? ((json as { data: unknown[] }).data)
        : undefined;
    if (!list) return undefined;
    const models: Record<string, ModelsDevModel> = {};
    for (const raw of list) {
      const mapped = mapCompatibleModel((raw ?? {}) as CompatibleModelEntry);
      if (mapped) models[mapped.id] = mapped;
    }
    if (Object.keys(models).length === 0) return undefined;
    return {
      id: providerId,
      name: opts.providerName ?? providerId,
      // Classifies to the openai-compatible wire family in the registry.
      npm: '@ai-sdk/openai-compatible',
      api: base,
      env: [],
      models,
    };
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
