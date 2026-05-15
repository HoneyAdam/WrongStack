export function redactKeys(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactKeys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/api.?key|secret|token|pass/i.test(k) && typeof v === 'string' && v.length > 0)
      out[k] = '[REDACTED]';
    else out[k] = redactKeys(v);
  }
  return out;
}
