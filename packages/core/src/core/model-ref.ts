/** A provider-qualified or provider-relative model reference. */
export interface ModelRef {
  provider?: string | undefined;
  model: string;
}

/** Parse `model`, `provider/model`, or `provider model`. */
export function parseModelRef(ref: string): ModelRef {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');
  if (slash !== -1) {
    return {
      provider: trimmed.slice(0, slash) || undefined,
      model: trimmed.slice(slash + 1).trim(),
    };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return { provider: parts[0], model: parts.slice(1).join(' ') };
  }
  return { model: trimmed };
}

export function formatModelRef(ref: ModelRef, defaultProvider?: string | undefined): string {
  const provider = ref.provider ?? defaultProvider;
  return provider ? `${provider}/${ref.model}` : ref.model;
}

export function normalizeModelRef(ref: string, defaultProvider?: string | undefined): string {
  return formatModelRef(parseModelRef(ref), defaultProvider);
}
