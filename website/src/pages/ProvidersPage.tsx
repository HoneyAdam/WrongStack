import { ArrowDown, Check, KeyRound, Radio, RefreshCw, Route, Sparkles } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';
import { Link } from '@/lib/router';

const families = [
  ['Anthropic', 'Native Messages API + SSE', 'Anthropic, MiniMax, Kimi, Vertex Anthropic'],
  [
    'OpenAI',
    'Chat Completions / Responses-style streaming',
    'OpenAI and compatible first-party surfaces',
  ],
  [
    'OpenAI-compatible',
    'OpenAI-spec endpoints + SSE',
    'Groq, Mistral, DeepSeek, OpenRouter, Ollama and many more',
  ],
  ['Google', 'Gemini streamGenerateContent', 'Google AI Studio and Gemini-family endpoints'],
] as const;

const matrixExample = `"modelMatrix": {
  "security-scanner": {
    "provider": "anthropic",
    "model": "review-model",
    "fallbackProfile": "careful"
  },
  "implement": {
    "modelRuntime": {
      "reasoning": { "effort": "high" }
    }
  },
  "*": { "model": "fast-worker" }
}`;

export function ProvidersPage() {
  return (
    <>
      <PageHero
        index="14"
        eyebrow="Providers & models"
        title={
          <>
            One contract.
            <br />
            <span className="text-brand-2">Many model paths.</span>
          </>
        }
        description="Provider adapters translate wire formats into the same streaming, tool, usage and error contract. Model routing decides which path handles each role; fallback handles temporary capacity failure."
        aside={
          <ExternalDoc path="docs/provider-author-guide.md">Open provider author guide</ExternalDoc>
        }
      />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="01"
          eyebrow="Wire families"
          title="The catalog is large; the protocol surface stays small."
          description="Models and prices refresh from models.dev. Four adapter families cover native and compatible transports without hardcoding every model into the agent."
        />
        <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-card">
          {families.map(([name, transport, examples], index) => (
            <div
              key={name}
              className="grid gap-3 border-b border-line p-5 last:border-b-0 sm:grid-cols-[44px_170px_280px_1fr] sm:items-center"
            >
              <span className="font-mono text-xs font-black text-brand-2">0{index + 1}</span>
              <strong className="text-sm text-fg">{name}</strong>
              <code className="font-mono text-[10px] text-brand">{transport}</code>
              <p className="text-sm leading-6 text-muted">{examples}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro
            index="02"
            eyebrow="Credentials"
            title="Metered API key or existing subscription."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
            {[
              [
                KeyRound,
                'API key',
                'Encrypted in the per-machine vault or supplied through an environment variable.',
                'wstack auth <provider>',
              ],
              [
                Sparkles,
                'ChatGPT / Codex',
                'PKCE loopback OAuth with refresh and Responses API provider routing.',
                'wstack auth login chatgpt',
              ],
              [
                Sparkles,
                'Claude Pro / Max',
                'Vendor OAuth flow with encrypted refresh token storage.',
                'wstack auth login claude',
              ],
              [
                Sparkles,
                'GitHub Copilot',
                'GitHub device flow and self-refreshing access.',
                'wstack auth login copilot',
              ],
            ].map(([Icon, title, body, command]) => {
              const ItemIcon = Icon as typeof KeyRound;
              return (
                <article key={String(title)} className="bg-card p-6">
                  <ItemIcon className="size-5 text-brand" />
                  <h2 className="mt-8 font-black text-fg">{String(title)}</h2>
                  <p className="mt-3 text-sm leading-6 text-muted">{String(body)}</p>
                  <code className="mt-6 block overflow-x-auto font-mono text-[9px] text-brand">
                    {String(command)}
                  </code>
                </article>
              );
            })}
          </div>
          <div className="mt-8">
            <ExternalDoc path="docs/oauth-signin.md">
              Read OAuth token storage and refresh details
            </ExternalDoc>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="03"
          eyebrow="Model matrix"
          title="Route by exact role, then phase, then wildcard."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[.75fr_1fr]">
          <div className="rounded-2xl border border-line bg-ink p-6 text-zinc-300">
            <pre className="overflow-x-auto font-mono text-[11px] leading-6">
              <code>{matrixExample}</code>
            </pre>
          </div>
          <div className="space-y-2">
            {[
              ['01', 'Exact role', 'A named specialist route wins first.'],
              ['02', 'Role phase', 'Workflow phase can supply a route or only runtime reasoning.'],
              ['03', 'Wildcard', 'Fleet-wide default without changing the leader.'],
              ['04', 'Leader', 'Final inherited provider, model and runtime controls.'],
            ].map(([number, title, body], index) => (
              <div key={title}>
                <div className="grid grid-cols-[36px_120px_1fr] gap-3 rounded-xl border border-line bg-card p-4">
                  <span className="font-mono text-xs font-black text-brand-2">{number}</span>
                  <strong className="text-sm text-fg">{title}</strong>
                  <p className="text-sm text-muted">{body}</p>
                </div>
                {index < 3 && <ArrowDown className="mx-auto my-1 size-4 text-faint" />}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro
            index="04"
            eyebrow="One session, many models"
            title="Different providers can work on the same objective at the same time."
            description="The leader, specialist roles, fallback paths and Brain Council resolve credentials independently, then communicate through shared tasks and the project mailbox."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Leader', 'Anthropic', 'Plans the objective and verifies the final result.'],
              [
                'Implementer',
                'OpenAI',
                'Executes a bounded code task with a high reasoning profile.',
              ],
              [
                'Researcher',
                'Google',
                'Explores an independent question with its own context budget.',
              ],
              [
                'Council',
                'Mixed providers',
                'Votes independently so one provider family is not the only judgment source.',
              ],
            ].map(([role, route, body]) => (
              <article key={role} className="bg-card p-6">
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-faint">
                  {role}
                </span>
                <h2 className="mt-5 text-xl font-black text-fg">{route}</h2>
                <p className="mt-3 text-sm leading-6 text-muted">{body}</p>
              </article>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-5">
            <Link href="/features/model-routing" className="text-sm font-black text-brand">
              Model routing deep dive →
            </Link>
            <Link href="/features/brain-council" className="text-sm font-black text-brand">
              Multi-model Council →
            </Link>
          </div>
        </div>
      </section>
      <section className="border-y border-line bg-ink text-white">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro
            index="05"
            eyebrow="Failure path"
            title="Retry, fallback, recovery—in that order."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              [
                RefreshCw,
                'In-place retry',
                'Same provider and model. Kind-specific attempt count with Retry-After or exponential jitter.',
              ],
              [
                Route,
                'Cross-provider fallback',
                'Only capacity and transport kinds hop after the current provider exhausts retries.',
              ],
              [
                Radio,
                'Recovery strategy',
                'Overflow compaction, cheaper-model downgrade or close-cost sibling reroute, capped at two.',
              ],
            ].map(([Icon, title, body]) => {
              const ItemIcon = Icon as typeof Route;
              return (
                <article
                  key={String(title)}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"
                >
                  <ItemIcon className="size-5 text-brand" />
                  <h2 className="mt-8 text-xl font-black">{String(title)}</h2>
                  <p className="mt-3 text-sm leading-7 text-zinc-500">{String(body)}</p>
                </article>
              );
            })}
          </div>
          <div className="mt-8 flex items-center gap-3 text-sm text-emerald-400">
            <Check className="size-4" /> Invalid requests, authentication failures and content shape
            errors do not hop providers.
          </div>
          <div className="mt-6 flex gap-5">
            <Link href="/commands/setmodel" className="text-sm font-bold text-brand">
              Learn /setmodel →
            </Link>
            <Link href="/commands/fallback" className="text-sm font-bold text-brand">
              Learn /fallback →
            </Link>
          </div>
        </div>
      </section>
      <PageNext
        label="Memory & sessions"
        title="Preserve continuity across model windows"
        body="Understand session logs, verified project memory, checkpoints and compaction."
        href="/memory"
      />
    </>
  );
}
