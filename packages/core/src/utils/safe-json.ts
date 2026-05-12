export interface SafeParseResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export function safeParse<T = unknown>(input: string, maxBytes = 5_000_000): SafeParseResult<T> {
  if (input.length > maxBytes) {
    return { ok: false, error: `Input exceeds limit (${maxBytes} bytes)` };
  }
  try {
    return { ok: true, value: JSON.parse(input) as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function safeStringify(value: unknown, pretty = false): string {
  const seen = new WeakSet();
  const replacer = (_k: string, v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v as object)) return '[Circular]';
      seen.add(v as object);
    }
    return v;
  };
  try {
    return JSON.stringify(value, replacer, pretty ? 2 : undefined) ?? 'null';
  } catch (err) {
    return JSON.stringify({
      __serialization_error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Attempt to sanitize buggy JSON from compatible providers. */
export function sanitizeJsonString(s: string): string {
  let out = s.trim();
  // Strip trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, '$1');
  // Replace unescaped control characters in strings (best-effort)
  return out;
}
