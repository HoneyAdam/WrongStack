import { DefaultSecretScrubber } from '@wrongstack/core/security';

export interface RedactionDiagnosticResult {
  redactedFields: string[];
  unchangedFields: string[];
}

/**
 * Exercise the production secret scrubber with synthetic values and return
 * field names only. Raw sample values never cross this diagnostic boundary.
 */
export function runRedactionDiagnostic(): RedactionDiagnosticResult {
  const sample = {
    apiKey: 'sk-1234567890abcdefghij',
    githubToken: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    env: { ANTHROPIC_API_KEY: 'ant-1234567890abcdef' },
    url: 'mongodb+srv://user:p4ssw0rd@cluster.mongodb.net/db',
    normal: 'this is not sensitive',
  };
  const scrubbed = new DefaultSecretScrubber().scrubObject(sample);
  const redactedFields: string[] = [];
  const unchangedFields: string[] = [];

  function walk(prefix: string, before: unknown, after: unknown): void {
    if (typeof before === 'string' && typeof after === 'string') {
      (before === after ? unchangedFields : redactedFields).push(prefix);
      return;
    }
    if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return;
    for (const key of Object.keys(before as Record<string, unknown>)) {
      walk(
        `${prefix}.${key}`,
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
      );
    }
  }

  walk('$', sample, scrubbed);
  return { redactedFields, unchangedFields };
}
