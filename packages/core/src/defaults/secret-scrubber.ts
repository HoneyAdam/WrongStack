import type { SecretScrubber } from '../types/secret-scrubber.js';

interface Pattern {
  type: string;
  regex: RegExp;
}

const PATTERNS: Pattern[] = [
  { type: 'anthropic_key', regex: /sk-ant-api\d+-[A-Za-z0-9_-]{20,}/g },
  { type: 'openai_key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { type: 'github_pat', regex: /ghp_[A-Za-z0-9]{36,}/g },
  { type: 'github_pat_v2', regex: /github_pat_[A-Za-z0-9_]{50,}/g },
  { type: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g },
  { type: 'gcp_key', regex: /AIza[0-9A-Za-z_-]{35}/g },
  { type: 'slack_token', regex: /xox[abpos]-[A-Za-z0-9-]{10,}/g },
  { type: 'stripe_key', regex: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { type: 'twilio_sid', regex: /AC[a-f0-9]{32}/g },
  {
    type: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    type: 'private_key',
    regex: /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP)? ?PRIVATE KEY-----[\s\S]*?-----END[^-]*-----/g,
  },
  { type: 'mongodb_uri', regex: /mongodb(?:\+srv)?:\/\/[^\s"'`]+/g },
  { type: 'postgres_uri', regex: /postgres(?:ql)?:\/\/[^\s"'`]+/g },
  { type: 'mysql_uri', regex: /mysql:\/\/[^\s"'`]+/g },
  { type: 'redis_uri', regex: /redis:\/\/[^\s"'`]+/g },
  { type: 'bearer_token', regex: /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  {
    type: 'high_entropy_env',
    // e.g. SOMETHING_KEY=abcdef1234567890... — common in .env style
    regex: /\b([A-Z_]{4,}(?:KEY|TOKEN|SECRET|PASSWORD|PWD))\s*[:=]\s*['"]?([A-Za-z0-9_/+=-]{20,})['"]?/g,
  },
];

export class DefaultSecretScrubber implements SecretScrubber {
  scrub(text: string): string {
    if (!text) return text;
    let out = text;
    for (const p of PATTERNS) {
      out = out.replace(p.regex, (_match, group1, group2) => {
        if (p.type === 'high_entropy_env' && group1 && group2) {
          return `${group1}=[REDACTED:${p.type}]`;
        }
        return `[REDACTED:${p.type}]`;
      });
    }
    return out;
  }

  scrubObject<T>(obj: T): T {
    const seen = new WeakSet();
    const visit = (v: unknown): unknown => {
      if (typeof v === 'string') return this.scrub(v);
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v as object)) return v;
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(visit);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = visit(val);
      }
      return out;
    };
    return visit(obj) as T;
  }
}
