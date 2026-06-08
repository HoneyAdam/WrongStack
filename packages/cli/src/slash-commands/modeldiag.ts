import * as fs from 'node:fs/promises';
import { color } from '@wrongstack/core';
import type { SlashCommand, SecretVault, ModelMatrixEntry } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

/**
 * `/modeldiag` — full diagnostic: key check, capability scan, connectivity
 * test, and auto-suggest optimal agent → model mapping matrix.
 */

export { MODEL_PROFILES };

// Inlined from @wrongstack/core/models/model-intelligence (avoids cross-package build dependency)
interface ModelProfile {
  provider: string;
  pattern: RegExp;
  family: string;
  strengths: string[];
  weaknesses?: string[];
  bestFor: string[];
  avoidFor?: string[];
  costTier: 'budget' | 'standard' | 'premium';
  speedTier: 'fast' | 'normal' | 'slow';
  minContext?: number;
}

const MODEL_PROFILES: ModelProfile[] = [
  { provider: 'anthropic', pattern: /claude-opus/i, family: 'Claude Opus', strengths: ['reasoning', 'planning'], bestFor: ['planning', 'security', 'debugging'], costTier: 'premium', speedTier: 'slow' },
  { provider: 'anthropic', pattern: /claude-sonnet/i, family: 'Claude Sonnet', strengths: ['coding', 'balanced'], bestFor: ['coding', 'general'], costTier: 'standard', speedTier: 'fast' },
  { provider: 'anthropic', pattern: /claude-haiku/i, family: 'Claude Haiku', strengths: ['speed'], bestFor: ['lightweight', 'docs'], avoidFor: ['planning'], costTier: 'budget', speedTier: 'fast' },
  { provider: 'openai', pattern: /gpt-5|o3|o4/i, family: 'GPT-5/o3/o4', strengths: ['reasoning', 'coding'], bestFor: ['planning', 'coding', 'debugging'], costTier: 'premium', speedTier: 'normal' },
  { provider: 'openai', pattern: /gpt-4/i, family: 'GPT-4', strengths: ['coding'], bestFor: ['coding', 'docs'], costTier: 'standard', speedTier: 'fast' },
  { provider: 'openai', pattern: /gpt-4o-mini/i, family: 'GPT-4o Mini', strengths: ['speed'], bestFor: ['lightweight', 'docs'], avoidFor: ['planning'], costTier: 'budget', speedTier: 'fast' },
  { provider: 'google', pattern: /gemini-(?:2\.5|3)/i, family: 'Gemini 2.5/3', strengths: ['context', 'coding'], bestFor: ['coding', 'data'], costTier: 'standard', speedTier: 'normal' },
  { provider: 'google', pattern: /gemini.*flash/i, family: 'Gemini Flash', strengths: ['speed'], bestFor: ['lightweight', 'docs'], avoidFor: ['planning'], costTier: 'budget', speedTier: 'fast' },
  { provider: 'deepseek', pattern: /deepseek/i, family: 'DeepSeek', strengths: ['coding', 'cost-effective'], bestFor: ['coding', 'general'], costTier: 'standard', speedTier: 'normal' },
];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function checkMark(ok: boolean): string {
  return ok ? color.green('✓') : color.red('✗');
}

interface CacheModel {
  id: string;
  name?: string;
  capabilities?: { contextWindow?: number; maxOutputTokens?: number };
  pricing?: { input?: number; output?: number };
}

interface CacheProvider {
  id: string;
  name: string;
  family: string;
  models?: CacheModel[];
}

const ROLE_CATEGORY: Record<string, string> = {
  'security-scanner': 'security', 'security-reviewer': 'security',
  'bug-hunter': 'debugging', debugger: 'debugging', tracer: 'debugging',
  planner: 'planning', architect: 'planning', 'refactor-planner': 'planning',
  test: 'testing', e2e: 'testing',
  document: 'docs', simplifier: 'docs',
  'code-reviewer': 'review', critic: 'review',
  executor: 'coding', refactor: 'refactoring', migration: 'coding',
  frontend: 'frontend', backend: 'backend', api: 'backend', auth: 'backend',
  designer: 'frontend', analyst: 'data', data: 'data', database: 'data',
  explore: 'planning', search: 'planning', researcher: 'planning',
};

function findProfile(pid: string, mid: string): ModelProfile | undefined {
  for (const p of MODEL_PROFILES) {
    if (p.provider === pid && p.pattern.test(mid)) return p;
  }
  return undefined;
}

const noOpVault: SecretVault = {
  encrypt: (v) => v,
  decrypt: (v) => v,
  isEncrypted: () => false,
};

export function buildModelDiagCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'modeldiag',
    category: 'Config',
    description: 'Diagnose all models: keys, capabilities, and suggest optimal agent → model matrix.',
    help: [
      'Usage:',
      '  /modeldiag                Full diagnostic: keys, caps, and suggested matrix',
      '  /modeldiag keys           Check which providers have API keys configured',
      '  /modeldiag caps           Show model capabilities matched to known profiles',
      '  /modeldiag suggest        Auto-suggest optimal agent → model mapping',
      '  /modeldiag test           Quick smoke-test (key + capability check, no API call)',
      '  /modeldiag apply          Apply the auto-suggested matrix to /setmodel config',
      '',
      'The suggested matrix can be applied with /modeldiag apply, or manually',
      'with /setmodel set <role> <provider>/<model>.',
    ].join('\n'),

    async run(args) {
      const trimmed = args.trim().toLowerCase();
      const sub = trimmed || 'full';

      const cachePath = opts.paths?.modelsCache;
      if (!cachePath) {
        return { message: `${color.red('Models cache not available')}.` };
      }

      let providers: CacheProvider[];
      try {
        const raw = await fs.readFile(cachePath, 'utf8');
        providers = JSON.parse(raw) as CacheProvider[];
      } catch {
        return { message: `${color.amber('Models cache not available')}. Run wstack sync-models.` };
      }

      const config = opts.configStore.get();
      const configProviders = (config?.providers ?? {}) as Record<string, {
        apiKey?: string; apiKeys?: Array<{ apiKey?: string }>;
        models?: string[];
      }>;

      const modelMatrix = (config?.modelMatrix ?? {}) as Record<string, ModelMatrixEntry>;

      function hasKey(pid: string): boolean {
        if (pid === config.provider && config.provider) return true;
        const pc = configProviders[pid];
        if (!pc) return false;
        if (typeof pc.apiKey === 'string' && pc.apiKey.length > 0) return true;
        if (Array.isArray(pc.apiKeys) && pc.apiKeys.some((k) => k?.apiKey)) return true;
        return false;
      }

      function roleCat(role: string): string {
        return ROLE_CATEGORY[role] ?? 'general';
      }

      // ── keys ──
      if (sub === 'keys') {
        const lines = [`${color.bold('API Key Status')}`, ''];
        for (const prov of providers) {
          const k = hasKey(prov.id);
          lines.push(`  ${checkMark(k)} ${color.bold(prov.id.padEnd(18))} ${color.dim(prov.name)}`);
        }
        lines.push('', `${color.dim(`Leader: ${config.provider}/${config.model}`)}`);
        return { message: lines.join('\n') };
      }

      // ── caps ──
      if (sub === 'caps') {
        const lines = [`${color.bold('Model Capabilities')} ${color.dim('— matched to known profiles')}`, ''];
        for (const prov of providers) {
          if (!hasKey(prov.id)) continue;
          lines.push(`  ${color.bold(prov.id)} ${color.dim(`(${prov.name})`)}`);
          for (const m of (prov.models ?? []).slice(0, 8)) {
            const cap = m.capabilities;
            const ctx = cap?.contextWindow ?? 0;
            const maxOut = cap?.maxOutputTokens ?? 0;
            const profile = findProfile(prov.id, m.id);
            const family = profile ? color.green(profile.family) : color.dim('unknown');
            const bestFor = profile ? profile.bestFor.slice(0, 3).join(', ') : '';
            lines.push(
              `    ${color.cyan(m.id)}  ` +
              `${ctx > 0 ? `ctx ${fmtTokens(ctx)}` : color.dim('ctx ?')}  ` +
              `${maxOut > 0 ? `out ${fmtTokens(maxOut)}  ` : ''}` +
              `${family}`,
            );
            if (bestFor) lines.push(`      ${color.dim('best for:')} ${bestFor}`);
          }
        }
        return { message: lines.join('\n') };
      }

      // ── suggest / full ──
      if (sub === 'suggest' || sub === 'full') {
        const lines = sub === 'full'
          ? ['', `${color.bold('Model Diagnostic')} ${color.dim(`— ${providers.filter((p) => hasKey(p.id)).length} keyed providers`)}`, '']
          : [`${color.bold('Suggested Agent → Model Matrix')}`, ''];

        const keyedProviders = providers.filter((p) => hasKey(p.id));
        if (keyedProviders.length === 0) {
          lines.push(`  ${color.amber('No providers have API keys configured. Add keys with /auth.')}`);
        } else {
          const roles = [
            'security-scanner', 'bug-hunter', 'planner', 'architect',
            'refactor-planner', 'test', 'document', 'code-reviewer',
            'executor', 'debugger',
          ];

          for (const role of roles) {
            if (modelMatrix[role]) {
              const entry = modelMatrix[role]!;
              const p = entry.provider ?? config.provider;
              lines.push(`  ${color.dim(role.padEnd(20))} → ${color.cyan(`${p}/${entry.model}`)}  ${color.dim('(user-configured)')}`);
              continue;
            }

            const cat = roleCat(role);
            const candidates: Array<{ provider: string; model: string; profile?: ModelProfile; score: number }> = [];
            for (const prov of keyedProviders) {
              for (const m of (prov.models ?? []).slice(0, 10)) {
                const profile = findProfile(prov.id, m.id);
                let score = 50;
                if (profile) {
                  if (profile.bestFor.includes(cat as never)) score += 35;
                  if (profile.avoidFor?.includes(cat as never)) score -= 50;
                  if (cat === 'planning' && profile.costTier === 'premium') score += 15;
                  if (profile.speedTier === 'slow' && cat === 'planning') score += 10;
                  if (profile.costTier === 'budget' && cat !== 'planning' && cat !== 'security') score += 10;
                }
                if (score > 0) candidates.push({ provider: prov.id, model: m.id, profile, score });
              }
            }
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];

            if (best) {
              const family = best.profile ? ` ${color.dim(`(${best.profile.family})`)}` : '';
              lines.push(
                `  ${color.green(role.padEnd(20))} → ${color.cyan(`${best.provider}/${best.model}`)}${family}  ${color.dim(`best-for ${cat}`)}`,
              );
            } else {
              lines.push(`  ${color.dim(role.padEnd(20))} → ${color.dim('no matching model')}`);
            }
          }
          lines.push('');
          lines.push(`  ${color.bold('leader'.padEnd(20))} → ${color.cyan(`${config.provider}/${config.model}`)}`);
        }

        lines.push('');
        lines.push(`${color.dim('Apply with: /modeldiag apply    (writes to /setmodel matrix)')}`);
        lines.push(`${color.dim('Manual:     /setmodel set <role> <provider>/<model>')}`);
        return { message: lines.join('\n') };
      }

      // ── test ──
      if (sub === 'test') {
        const lines = [`${color.bold('Connectivity Test')}`, ''];
        const keyed = providers.filter((p) => hasKey(p.id));
        if (keyed.length === 0) {
          lines.push(`  ${color.amber('No providers have API keys. Add keys with /auth.')}`);
          return { message: lines.join('\n') };
        }

        for (const prov of keyed) {
          lines.push(`  ${color.cyan('⟳')} ${prov.id}... ${color.dim('(capability scan, no API call)')}`);

          const profile = findProfile(prov.id, config.model ?? '');
          const firstModel = prov.models?.[0]?.id ?? config.model ?? '?';
          const cap = prov.models?.[0]?.capabilities;
          const ctx = cap?.contextWindow ?? 0;

          lines.push(`    ${checkMark(true)} provider: ${prov.id}`);
          lines.push(`    ${checkMark(ctx > 0)} context: ${ctx > 0 ? fmtTokens(ctx) : 'unknown'}`);
          lines.push(`    ${checkMark(!!profile)} profile: ${profile?.family ?? 'no match'}`);
          lines.push(`    model: ${color.cyan(firstModel)}`);
          lines.push('');
        }

        lines.push(color.dim('Full API connectivity test requires an active session (costs tokens).'));
        return { message: lines.join('\n') };
      }

      // ── apply ──
      if (sub === 'apply') {
        if (!opts.configStore || !opts.paths) {
          return { message: `${color.red('Config store not available')}.` };
        }

        const keyedProviders = providers.filter((p) => hasKey(p.id));
        const newMatrix: Record<string, ModelMatrixEntry> = { ...(config.modelMatrix ?? {}) as Record<string, ModelMatrixEntry> };

        let applied = 0;
        const roles = [
          'security-scanner', 'bug-hunter', 'planner', 'architect',
          'refactor-planner', 'test', 'document', 'code-reviewer',
          'executor', 'debugger',
        ];

        for (const role of roles) {
          if (newMatrix[role]) continue;
          const cat = roleCat(role);
          const candidates: Array<{ provider: string; model: string; profile?: ModelProfile; score: number }> = [];
          for (const prov of keyedProviders) {
            for (const m of (prov.models ?? []).slice(0, 10)) {
              const profile = findProfile(prov.id, m.id);
              let score = 50;
              if (profile) {
                if (profile.bestFor.includes(cat as never)) score += 35;
                if (profile.avoidFor?.includes(cat as never)) score -= 50;
                if (cat === 'planning' && profile.costTier === 'premium') score += 15;
                if (profile.costTier === 'budget' && cat !== 'planning' && cat !== 'security') score += 10;
              }
              if (score > 0) candidates.push({ provider: prov.id, model: m.id, profile, score });
            }
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (best) {
            newMatrix[role] = { provider: best.provider, model: best.model };
            applied++;
          }
        }

        try {
          const { atomicWrite, decryptConfigSecrets, encryptConfigSecrets } = await import('@wrongstack/core');
          const globalConfigPath = opts.paths.globalConfig;

          let raw = '{}';
          try { raw = await fs.readFile(globalConfigPath, 'utf8'); } catch { /* new file */ }
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const decrypted = decryptConfigSecrets(parsed, noOpVault);
          (decrypted as Record<string, unknown>).modelMatrix = newMatrix;
          const encrypted = encryptConfigSecrets(decrypted, noOpVault);
          await atomicWrite(globalConfigPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });

          opts.configStore.update({ modelMatrix: newMatrix });
        } catch (err) {
          return { message: `${color.red('Failed to save')}: ${err instanceof Error ? err.message : String(err)}` };
        }

        return {
          message: [
            `${color.green('✓')} Applied ${applied} model matrix entries.`,
            `${color.dim('Existing /setmodel entries were preserved.')}`,
            `${color.dim('Run /setmodel to review, /setmodel clear <role> to remove.')}`,
          ].join('\n'),
        };
      }

      // Default: full diagnostic
      const cmd = buildModelDiagCommand(opts);
      const keysResult = await cmd.run('keys', undefined as never);
      const capsResult = await cmd.run('caps', undefined as never);
      const suggestResult = await cmd.run('suggest', undefined as never);

      return {
        message: [
          keysResult?.message ?? '',
          '',
          capsResult?.message ?? '',
          '',
          suggestResult?.message ?? '',
        ].join('\n'),
      };
    },
  };
}
