import * as fs from 'node:fs/promises';
import { color } from '@wrongstack/core';
import type { SlashCommand, ModelMatrixEntry } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

/**
 * `/modeldiag` — read-only diagnostics: key check, capability scan, heuristic
 * suggestions, and real model benchmarking. Never modifies config.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtPrice(usdPer1M: number | undefined): string {
  if (usdPer1M === undefined) return color.dim('?');
  if (usdPer1M >= 10) return `$${usdPer1M.toFixed(1)}`;
  return `$${usdPer1M.toFixed(2)}`;
}

function checkMark(ok: boolean): string {
  return ok ? color.green('✓') : color.red('✗');
}

function costLabel(tier: string): string {
  switch (tier) {
    case 'premium': return color.red('$$$');
    case 'standard': return color.amber('$$');
    case 'budget': return color.green('$');
    default: return color.dim('?');
  }
}

function speedLabel(tier: string): string {
  switch (tier) {
    case 'fast': return color.green('⚡');
    case 'normal': return color.amber('→');
    case 'slow': return color.red('🐢');
    default: return color.dim('?');
  }
}

function scoreBar(score: number, max: number): string {
  const pct = Math.min(1, Math.max(0, score / max));
  const filled = Math.round(pct * 10);
  const bar = color.green('█'.repeat(filled)) + color.dim('░'.repeat(10 - filled));
  return `${bar} ${score}/${max}`;
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

interface ScoredModel {
  provider: string;
  model: string;
  profile?: ModelProfile;
  score: number;
  ctxWindow: number;
  maxOutput: number;
  inputPrice?: number;
  outputPrice?: number;
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

// ---------------------------------------------------------------------------
// Candidate scoring — profile-based heuristics (NOT tested, purely advisory)
// ---------------------------------------------------------------------------

function scoreModel(
  pid: string,
  mid: string,
  category: string,
  ctxWindow: number,
): { score: number; profile?: ModelProfile } {
  const profile = findProfile(pid, mid);
  let score = 50; // baseline — any model with a key is a candidate

  if (profile) {
    if (profile.bestFor.includes(category as never)) score += 35;
    if (profile.avoidFor?.includes(category as never)) score -= 50;
    if (category === 'planning' && profile.costTier === 'premium') score += 15;
    if (profile.speedTier === 'slow' && category === 'planning') score += 10;
    if (profile.costTier === 'budget' && category !== 'planning' && category !== 'security') score += 10;
  }

  // Favor models with larger context windows (proxy for capability)
  if (ctxWindow > 200_000) score += 10;
  else if (ctxWindow > 100_000) score += 5;
  else if (ctxWindow > 32_000) score += 2;

  return { score, profile };
}

function rankModels(
  providers: CacheProvider[],
  hasKey: (pid: string) => boolean,
  category: string,
  limit: number,
): ScoredModel[] {
  const candidates: ScoredModel[] = [];

  for (const prov of providers) {
    if (!hasKey(prov.id)) continue;
    for (const m of (prov.models ?? [])) {
      const ctxWindow = m.capabilities?.contextWindow ?? 0;
      const { score, profile } = scoreModel(prov.id, m.id, category, ctxWindow);
      if (score > 0) {
        candidates.push({
          provider: prov.id,
          model: m.id,
          profile,
          score,
          ctxWindow,
          maxOutput: m.capabilities?.maxOutputTokens ?? 0,
          inputPrice: m.pricing?.input,
          outputPrice: m.pricing?.output,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Standardized evaluation prompts per agentic task category
// ---------------------------------------------------------------------------

interface EvalTask {
  label: string;
  prompt: string;
}

const EVAL_TASKS: Record<string, EvalTask> = {
  coding: {
    label: 'Code Generation',
    prompt: 'Write a TypeScript function parseCSV(input: string): { headers: string[]; rows: string[][] } that handles quoted fields, escaped quotes, and empty lines. Return an error string on malformed input. Keep under 40 lines.',
  },
  planning: {
    label: 'Architecture Planning',
    prompt: 'Design the folder structure and key interfaces for a monorepo CLI tool with slash commands, model routing, subagent spawning, and config persistence. List packages, their responsibilities, and the 5 most important TypeScript interfaces.',
  },
  security: {
    label: 'Vulnerability Detection',
    prompt: 'Review this code for security issues:\n```ts\napp.get("/api/user", (req, res) => {\n  const id = req.query.id;\n  const user = db.query("SELECT * FROM users WHERE id = " + id);\n  res.json(user);\n});\n\napp.post("/api/run", (req, res) => {\n  const { cmd } = req.body;\n  exec("echo " + cmd, (err, stdout) => res.send(stdout));\n});\n```\nList every vulnerability, its severity (critical/high/medium), and the exact fix.',
  },
  debugging: {
    label: 'Bug Diagnosis',
    prompt: 'This async function has 2 bugs. Find and fix both:\n```ts\nasync function processBatch(items: string[]) {\n  const results = [];\n  for (const item of items) {\n    const result = await fetch("https://api.example.com/" + item);\n    results.push(result);\n  }\n  return results.map(r => r.json());\n}\n```\nExplain what each bug is, why it fails, and write the corrected version.',
  },
  testing: {
    label: 'Test Authoring',
    prompt: 'Write vitest test cases for this deepMerge function:\n```ts\nfunction deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {\n  const merged = { ...base };\n  for (const [key, val] of Object.entries(overrides)) {\n    if (val === null) { delete merged[key]; continue; }\n    if (typeof val === "object" && !Array.isArray(val) && typeof merged[key] === "object" && !Array.isArray(merged[key])) {\n      merged[key] = deepMerge(merged[key] as Record<string, unknown>, val as Record<string, unknown>);\n    } else { merged[key] = val; }\n  }\n  return merged;\n}\n```\nCover: happy path, edge cases, and error conditions.',
  },
  docs: {
    label: 'Documentation',
    prompt: 'Write TSDoc comments for this RateLimiter interface. Include @param, @returns, @throws, and @example for each method:\n```ts\ninterface RateLimiter {\n  tryAcquire(key: string, maxPerWindow: number, windowMs: number): Promise<boolean>;\n  getRemaining(key: string): Promise<number>;\n  reset(key: string): Promise<void>;\n}\n```',
  },
  review: {
    label: 'Code Review',
    prompt: 'Review this PR change:\n```diff\n async function loadConfig(path: string) {\n-  const raw = await fs.readFile(path, "utf8");\n-  return JSON.parse(raw);\n+  const raw = await fs.readFile(path);\n+  const config = JSON.parse(raw);\n+  process.env.API_KEY = config.apiKey;\n+  return config;\n }\n```\nList issues by severity (blocking / should-fix / nit) and explain your reasoning.',
  },
  refactoring: {
    label: 'Refactoring',
    prompt: 'Refactor this nested condition into a cleaner pattern:\n```ts\nfunction getDiscount(user: { type: string; years: number; coupon?: string }): number {\n  if (user.type === "premium") {\n    if (user.years > 5) {\n      if (user.coupon === "BLACKFRIDAY") return 0.5;\n      return 0.3;\n    }\n    return 0.2;\n  }\n  if (user.type === "standard") {\n    if (user.years > 3) return 0.15;\n    return 0.1;\n  }\n  return 0;\n}\n```\nShow your refactored code and explain why your approach is cleaner.',
  },
};

const EVAL_CATEGORIES = Object.keys(EVAL_TASKS);

type EvalProvider = {
  complete: (
    req: { model: string; system?: Array<{ type: 'text'; text: string }>; messages: Array<{ role: string; content: Array<{ type: 'text'; text: string }> }>; maxTokens: number },
    opts: { signal: AbortSignal },
  ) => Promise<{ content: Array<{ text?: string }> }>;
};

async function rankResponses(
  provider: EvalProvider,
  leaderModel: string,
  taskPrompt: string,
  responses: Array<{ model: string; text: string }>,
): Promise<number[]> {
  const labelToIdx = new Map<string, number>();
  const responseBlock = responses
    .map((r, i) => {
      const label = String.fromCharCode(65 + i);
      labelToIdx.set(label, i);
      return '=== Response ' + label + ' ===\n' + r.text.slice(0, 800);
    })
    .join('\n\n');

  const rankingPrompt = 'Rank these responses from BEST (1) to WORST.\n\nTASK:\n' + taskPrompt.slice(0, 600) +
    '\n\nRESPONSES:\n' + responseBlock +
    '\n\nOutput ONLY a ranked list, one per line:\n1. Response X — brief reason\n2. Response Y — brief reason';

  try {
    const resp = await provider.complete(
      {
        model: leaderModel,
        system: [{ type: 'text' as const, text: 'You are an expert evaluator. Rank responses concisely. Output ONLY the ranked list.' }],
        messages: [{ role: 'user', content: [{ type: 'text' as const, text: rankingPrompt }] }],
        maxTokens: 400,
      },
      { signal: AbortSignal.timeout(30_000) },
    );

    const text: string = resp.content[0]?.text ?? '';
    const rankings: number[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(\d+)[\.\)]\s*Response\s+([A-Z])/i);
      if (m) {
        const label = m[2]!.toUpperCase();
        const idx = labelToIdx.get(label);
        if (idx !== undefined && !rankings.includes(idx)) {
          rankings.push(idx);
        }
      }
    }
    return rankings.length > 0 ? rankings : responses.map((_, i) => i);
  } catch {
    return responses.map((_, i) => i);
  }
}

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

export function buildModelDiagCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'modeldiag',
    category: 'Config',
    description: 'Diagnose models: keys, caps, heuristic suggestions, and benchmark testing.',
    help: [
      'Usage:',
      '  /modeldiag                      Full diagnostic: keys, caps, and heuristic suggestions',
      '  /modeldiag keys                 Check which providers have API keys configured',
      '  /modeldiag caps                 Structured model capabilities + pricing comparison',
      '  /modeldiag suggest              Heuristic agent→model suggestions (profile-based, untested)',
      '  /modeldiag test                 Quick smoke-test (key + capability scan, no API call)',
      '  /modeldiag bench <role> <prompt>  TEST models: send a prompt to top candidates, compare results',
      '',
      '  /modeldiag eval [role]            FULL evaluation: test models on standardized',
      '                                     agentic tasks, rank by leader model, show report',
      '  /modeldiag eval --quick            Quick eval: 1 model per category, fast report',
      '',
      'Heuristic suggestions (suggest) are based on known model profiles — they are NOT',
      'tested. Use /modeldiag bench <role> "<test prompt>" to manually test candidates,',
      'or /modeldiag eval for a full automated competency report.',
      '',
      'Apply chosen models manually with /setmodel set <role> <provider>/<model>.',
      '/modeldiag is read-only — it never modifies your config.',
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
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const payload = ((parsed.payload ?? parsed) as Record<string, Record<string, unknown>>);
        providers = Object.entries(payload).map(([id, p]) => ({
          id: (p.id as string) ?? id,
          name: (p.name as string) ?? id,
          family: (p.npm as string) ?? id,
          models: Object.values((p.models as Record<string, Record<string, unknown>>) ?? {}).map((m) => ({
            id: m.id as string,
            name: m.name as string | undefined,
            capabilities: {
              contextWindow: (m.limit as { context?: number } | undefined)?.context,
              maxOutputTokens: (m.limit as { output?: number } | undefined)?.output,
            },
            pricing: m.cost as { input?: number; output?: number } | undefined,
          })),
        }));
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
        const lines = [
          `${color.bold('Model Capabilities')} ${color.dim('— matched to known profiles')}`,
          '',
        ];

        for (const prov of providers) {
          if (!hasKey(prov.id)) continue;
          lines.push(`  ${color.bold(prov.id)} ${color.dim(`(${prov.name})`)}`);

          // Group by cost tier
          const tiers: Record<string, CacheModel[]> = { premium: [], standard: [], budget: [], unknown: [] };
          for (const m of (prov.models ?? [])) {
            const profile = findProfile(prov.id, m.id);
            tiers[profile?.costTier ?? 'unknown']!.push(m);
          }

          for (const tier of ['premium', 'standard', 'budget', 'unknown'] as const) {
            const tierModels = tiers[tier]!;
            if (tierModels.length === 0) continue;
            const label = tier === 'unknown' ? color.dim('unmatched') : `${costLabel(tier)} ${tier}`;
            lines.push(`    ${label}`);
            for (const m of tierModels) {
              const cap = m.capabilities;
              const ctx = cap?.contextWindow ?? 0;
              const maxOut = cap?.maxOutputTokens ?? 0;
              const profile = findProfile(prov.id, m.id);
              const family = profile
                ? `${speedLabel(profile.speedTier)} ${color.green(profile.family)}`
                : color.dim('no profile match');
              const pricing = m.pricing
                ? `${color.dim('in')}${fmtPrice(m.pricing.input)} ${color.dim('out')}${fmtPrice(m.pricing.output)}`
                : color.dim('pricing ?');
              lines.push(
                `      ${color.cyan(m.id.padEnd(34))}` +
                `${ctx > 0 ? `ctx ${fmtTokens(ctx).padEnd(6)}` : color.dim('ctx ?  ')}` +
                `${maxOut > 0 ? `out ${fmtTokens(maxOut).padEnd(6)}` : '        '}` +
                `${family.padEnd(0)}   ${pricing}`,
              );
            }
          }
          lines.push('');
        }

        lines.push(color.dim('Prices in USD per 1M tokens (input/output). ctx = context window, out = max output.'));
        return { message: lines.join('\n') };
      }

      // ── suggest ──
      if (sub === 'suggest' || sub === 'full') {
        const lines = sub === 'full'
          ? ['', `${color.bold('Model Diagnostic')} ${color.dim(`— ${providers.filter((p) => hasKey(p.id)).length} keyed providers`)}`, '']
          : [];

        lines.push(
          `${color.bold('Agent → Model Suggestions')} ${color.amber('(heuristic — untested)')}`,
          color.dim('These are profile-based best guesses. Test them with /modeldiag bench <role> "<prompt>".'),
          '',
        );

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
            const ranked = rankModels(providers, hasKey, cat, 3);

            if (ranked.length === 0) {
              lines.push(`  ${color.dim(role.padEnd(20))} → ${color.dim('no candidates')}`);
              continue;
            }

            const best = ranked[0]!;
            const family = best.profile ? ` ${color.dim(`(${best.profile.family})`)}` : '';
            const bar = scoreBar(best.score, 110);
            lines.push(
              `  ${color.amber(role.padEnd(20))} → ${color.cyan(`${best.provider}/${best.model}`)}${family}`,
              `  ${' '.repeat(22)}  ${bar}  ${color.dim(cat)}`,
            );

            // Show runners-up if they're close
            if (ranked.length > 1 && ranked[1]!.score >= best.score - 15) {
              for (const alt of ranked.slice(1)) {
                const af = alt.profile ? ` (${alt.profile.family})` : '';
                lines.push(`  ${' '.repeat(22)}  ${color.dim(`${alt.provider}/${alt.model}${af}  score ${alt.score}`)}`);
              }
            }
          }

          lines.push('');
          lines.push(`  ${color.bold('leader'.padEnd(20))} → ${color.cyan(`${config.provider}/${config.model}`)}`);
        }

        lines.push('');
        lines.push(color.dim('Pin a suggestion:  /setmodel set <role> <provider>/<model>'));
        lines.push(color.dim('Test candidates:   /modeldiag bench <role> "<test prompt>"'));
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
        lines.push(color.dim('Use /modeldiag bench <role> "<prompt>" to test models with real API calls.'));
        return { message: lines.join('\n') };
      }

      // ── bench <role> <prompt> ──
      if (sub === 'bench') {
        // Parse: /modeldiag bench verify "Write a function that checks if..."
        const benchArgs = args.trim().split(/\s+/).filter(Boolean).slice(1); // skip 'bench'
        if (benchArgs.length < 2) {
          return {
            message: [
              `${color.amber('Usage:')} /modeldiag bench <role> "<test prompt>"`,
              '',
              color.dim('Example: /modeldiag bench verify "Write a function that checks if a string is a palindrome"'),
              color.dim('Tests the top 5 candidate models for the role with your prompt and reports results.'),
            ].join('\n'),
          };
        }

        const benchRole = benchArgs[0]!;
        const benchPrompt = benchArgs.slice(1).join(' ');

        if (!opts.llmProvider) {
          return { message: `${color.red('No LLM provider available')}. Start a session first.` };
        }

        const leaderProvider = opts.llmProvider;

        // Resolve the role category
        const cat = roleCat(benchRole);
        const candidates = rankModels(providers, hasKey, cat, 5);

        if (candidates.length === 0) {
          return { message: `${color.amber('No candidate models found')} for role "${benchRole}" (category: ${cat}).` };
        }

        // Filter to candidates on the leader provider only (others need separate instances)
        const leaderCandidates = candidates.filter((c) => c.provider === leaderProvider.id);
        if (leaderCandidates.length === 0) {
          return {
            message: [
              `${color.amber('No candidates belong to the active provider')} (${leaderProvider.id}).`,
              color.dim('bench currently tests models on the leader provider only.'),
              `Candidate providers: ${[...new Set(candidates.map((c) => c.provider))].join(', ')}`,
            ].join('\n'),
          };
        }

        const lines: string[] = [
          `${color.bold('Model Benchmark')} — ${color.amber(benchRole)} ${color.dim(`(category: ${cat})`)}`,
          `${color.dim('Prompt:')} "${benchPrompt.slice(0, 120)}${benchPrompt.length > 120 ? '…' : ''}"`,
          '',
        ];

        // Table header
        lines.push(
          `  ${color.dim('#  model'.padEnd(44))} ${color.dim('score'.padEnd(12))} ${color.dim('latency'.padEnd(10))} ${color.dim('tokens'.padEnd(14))} ${color.dim('first line')}`,
          `  ${color.dim('─'.repeat(100))}`,
        );

        let idx = 0;
        for (const c of leaderCandidates.slice(0, 5)) {
          idx++;
          const label = `${idx}`.padStart(2);

          try {
            const start = Date.now();
            const resp = await leaderProvider.complete(
              {
                model: c.model,
                messages: [{ role: 'user', content: [{ type: 'text' as const, text: benchPrompt }] }],
                maxTokens: 256,
              },
              { signal: AbortSignal.timeout(30_000) },
            );
            const latency = Date.now() - start;
            const firstLine = resp.content[0]
              ? (('text' in resp.content[0] ? (resp.content[0] as { text: string }).text : JSON.stringify(resp.content[0]).slice(0, 80)))
              : color.dim('(empty)');
            const firstLineClean = (typeof firstLine === 'string' ? firstLine : String(firstLine))
              .replace(/\n/g, ' ')
              .slice(0, 80);

            lines.push(
              `  ${label} ${color.green(c.model.padEnd(42))} ${scoreBar(c.score, 110).slice(0, 11)}  ${color.amber(fmtMs(latency).padEnd(8))} ${color.dim(`in${resp.usage?.input ?? '?'}/out${resp.usage?.output ?? '?'}`.padEnd(12))} ${firstLineClean}`,
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            lines.push(
              `  ${label} ${color.red(c.model.padEnd(42))} ${scoreBar(c.score, 110).slice(0, 11)}  ${color.red('FAILED')}    ${color.dim(errMsg.slice(0, 40))}`,
            );
          }
        }

        lines.push('');
        lines.push(
          color.dim(`Tested ${leaderCandidates.length} model(s) on provider ${leaderProvider.id}.`),
          color.dim(`Pin the best: /setmodel set ${benchRole} ${leaderProvider.id}/<model>`),
        );

        return { message: lines.join('\n') };
      }

      // ── eval [role] ──
      if (sub === 'eval' || sub === 'evall') {
        if (!opts.llmProvider) {
          return { message: `${color.red('No LLM provider available')}. Start a session first.` };
        }
        const leaderProvider = opts.llmProvider;
        const leaderModel = opts.llmModel ?? config.model ?? 'unknown';

        const evalArgs = args.trim().split(/\s+/).filter(Boolean).slice(1);
        const quick = evalArgs.includes('--quick');
        const roleFilter = evalArgs.find((a) => !a.startsWith('--'));
        const modelsPerCat = quick ? 1 : 2;
        const targetCategories = roleFilter
          ? (EVAL_CATEGORIES.includes(roleCat(roleFilter)) ? [roleCat(roleFilter)] : [])
          : EVAL_CATEGORIES;

        if (targetCategories.length === 0 && roleFilter) {
          return { message: `${color.amber('Unknown role/category')}: "${roleFilter}". Try: ${EVAL_CATEGORIES.join(', ')}` };
        }

        const lines: string[] = [
          `${color.bold('Model Competency Evaluation')} ${color.dim(`— ${targetCategories.length} cats, ${modelsPerCat}/cat`)}`,
          color.dim(`Evaluator: ${leaderProvider.id}/${leaderModel}`),
          '',
        ];

        // Phase 1: collect responses
        const collected = new Map<string, Array<{ model: string; latency: number; tokens: number; text: string }>>();
        let total = 0; let ok = 0;

        for (const cat of targetCategories) {
          const task = EVAL_TASKS[cat];
          if (!task) continue;
          const candidates = rankModels(providers, hasKey, cat, modelsPerCat)
            .filter((c) => c.provider === leaderProvider.id);
          if (candidates.length === 0) continue;

          const results: Array<{ model: string; latency: number; tokens: number; text: string }> = [];
          for (const c of candidates) {
            total++;
            try {
              const start = Date.now();
              const resp = await leaderProvider.complete(
                { model: c.model, system: [{ type: 'text' as const, text: 'Be thorough and correct.' }], messages: [{ role: 'user', content: [{ type: 'text' as const, text: task.prompt }] }], maxTokens: 1024 },
                { signal: AbortSignal.timeout(45_000) },
              );
              const respText = resp.content[0] && 'text' in resp.content[0] ? (resp.content[0] as { text: string }).text : '';
              results.push({ model: c.model, latency: Date.now() - start, tokens: (resp.usage?.input ?? 0) + (resp.usage?.output ?? 0), text: respText });
              ok++;
            } catch { results.push({ model: c.model, latency: -1, tokens: 0, text: '' }); }
          }
          if (results.length > 0) collected.set(cat, results);
        }

        lines.push(`${color.dim(`Phase 1: ${ok}/${total} calls succeeded`)}`, '');

        if (collected.size === 0) {
          lines.push(color.amber('No responses collected. Check provider configuration.'));
          return { message: lines.join('\n') };
        }

        // Phase 2: leader ranking
        lines.push(`${color.bold('Phase 2')} — ${color.dim('leader ranks responses')}`, '');
        const rankings = new Map<string, Map<string, { rank: number; total: number }>>();

        for (const [cat, responses] of collected) {
          const valid = responses.filter((r) => r.latency >= 0);
          if (valid.length < 2) {
            if (valid.length === 1) {
              const m = valid[0]!.model;
              if (!rankings.has(m)) rankings.set(m, new Map());
              rankings.get(m)!.set(cat, { rank: 1, total: 1 });
            }
            continue;
          }
          const task = EVAL_TASKS[cat]!;
          const ranked = await rankResponses(leaderProvider as EvalProvider, leaderModel, task.prompt, valid);
          for (let i = 0; i < valid.length; i++) {
            const m = valid[ranked[i] ?? i]!.model;
            if (!rankings.has(m)) rankings.set(m, new Map());
            rankings.get(m)!.set(cat, { rank: i + 1, total: valid.length });
          }
        }

        // Phase 3: report matrix
        lines.push(`${color.bold('Competency Report')}`, '');
        const allModels = [...new Set([...rankings.keys()])].sort();
        const catList = [...collected.keys()];
        const cw = 12;

        lines.push(
          `  ${color.dim('model'.padEnd(24))}` +
          catList.map((c) => color.dim((EVAL_TASKS[c]?.label ?? c).slice(0, cw).padEnd(cw + 2))).join(''),
        );
        lines.push(`  ${color.dim('─'.repeat(24 + catList.length * (cw + 2)))}`);

        for (const model of allModels) {
          const mr = rankings.get(model)!;
          let row = `  ${color.cyan(model.padEnd(24))}`;
          for (const cat of catList) {
            const e = mr.get(cat);
            if (e) {
              const pct = Math.round((1 - (e.rank - 1) / Math.max(1, e.total - 1)) * 100);
              const pc = pct >= 80 ? color.green : pct >= 50 ? color.amber : color.red;
              row += `${pc(`#${e.rank} ${pct}%`.padEnd(cw + 2))}`;
            } else {
              row += color.dim('—'.padEnd(cw + 2));
            }
          }
          lines.push(row);
        }

        lines.push('', color.dim('#1 100% = best in category. — = not tested.'),
          '', color.dim(`Pin: /setmodel set <role> ${leaderProvider.id}/<model>`),
          color.dim('Full: /modeldiag eval      Quick: /modeldiag eval --quick'));
        return { message: lines.join('\n') };
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
