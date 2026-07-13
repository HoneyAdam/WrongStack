import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  GitBranch,
  Layers3,
  Radio,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { FleetTopologyPreview } from '@/components/site/FleetTopologyPreview';
import { CopyCommand, Eyebrow, Reveal, SectionIntro } from '@/components/site/primitives';
import {
  capabilityIndex,
  commands,
  homeJourneys,
  installCommand,
  nodeVersion,
  repoUrl,
  surfaces,
  version,
} from '@/data/content';
import { Link } from '@/lib/router';

const demoLines = [
  { type: 'command', text: 'wrongstack "trace the flaky checkout test and fix it"' },
  { type: 'phase', text: '⟳ DECIDE', detail: 'mapping test → service → provider boundary' },
  { type: 'tool', text: 'read', detail: 'packages/checkout/src/payment.ts' },
  { type: 'tool', text: 'grep', detail: 'retry|timeout · 8 matches' },
  { type: 'phase', text: '⚡ EXECUTE', detail: 'patching abort-safe retry boundary' },
  { type: 'tool', text: 'edit', detail: 'payment.ts  +14 −6' },
  { type: 'tool', text: 'test', detail: 'checkout.retry.test.ts  12 passed' },
  { type: 'done', text: '✓ FIXED', detail: '1 file changed · evidence attached' },
] as const;

function LiveRun() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(
      () => setCount((value) => (value >= demoLines.length ? 1 : value + 1)),
      780,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hero-console overflow-hidden rounded-[22px] border border-white/10 bg-[#08090d] text-zinc-200 shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span className="size-2 rounded-full bg-brand" />
          LIVE / SESSION 7D2A
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-zinc-600">
          <span>CTX 18%</span>
          <span className="hidden sm:inline">$0.014</span>
        </div>
      </div>
      <div className="grid min-h-[340px] sm:grid-cols-[1fr_150px]">
        <div className="p-4 font-mono text-[12px] leading-6 sm:p-6 sm:text-[13px]">
          {demoLines.slice(0, count).map((line) => (
            <motion.div
              key={`${line.text}-${count >= demoLines.length ? 2 : 1}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="grid grid-cols-[18px_auto] gap-2"
            >
              <span
                className={
                  line.type === 'done'
                    ? 'text-emerald-400'
                    : line.type === 'phase'
                      ? 'text-brand-2'
                      : line.type === 'command'
                        ? 'text-brand'
                        : 'text-zinc-600'
                }
              >
                {line.type === 'command'
                  ? '❯'
                  : line.type === 'done'
                    ? '●'
                    : line.type === 'phase'
                      ? '◆'
                      : '└'}
              </span>
              <span>
                <span
                  className={
                    line.type === 'done'
                      ? 'font-bold text-emerald-400'
                      : line.type === 'phase'
                        ? 'font-bold text-brand-2'
                        : line.type === 'tool'
                          ? 'text-sky-300'
                          : 'text-zinc-100'
                  }
                >
                  {line.text}
                </span>
                {'detail' in line && <span className="ml-2 text-zinc-500">{line.detail}</span>}
              </span>
            </motion.div>
          ))}
          <AnimatePresence>
            {count < demoLines.length && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1 }}
                className="ml-7 mt-1 inline-block h-4 w-1.5 bg-brand"
              />
            )}
          </AnimatePresence>
        </div>
        <div className="hidden border-l border-white/10 bg-white/[0.02] p-4 sm:block">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
            Run state
          </div>
          <div className="mt-5 space-y-5">
            {[
              [Radio, 'Provider', 'openai-codex'],
              [GitBranch, 'Branch', 'fix/checkout'],
              [ShieldCheck, 'Policy', 'confirm'],
              [Clock3, 'Elapsed', `${count * 2}.4s`],
            ].map(([Icon, label, value]) => {
              const ItemIcon = Icon as typeof Radio;
              return (
                <div key={String(label)}>
                  <ItemIcon className="size-3.5 text-zinc-600" />
                  <div className="mt-1.5 text-[10px] text-zinc-600">{String(label)}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-300">
                    {String(value)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      <section className="relative min-h-[760px] overflow-hidden border-b border-line pt-24 lg:pt-28">
        <div className="hero-noise absolute inset-0" aria-hidden="true" />
        <div
          className="hero-orbit absolute right-[-18vw] top-[-18vw] size-[70vw] max-h-[900px] max-w-[900px] rounded-full border border-line"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-[1380px] gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.03fr_.82fr] lg:items-center lg:px-10 lg:pb-20 lg:pt-20">
          <div>
            <div className="mb-8 flex flex-wrap items-center gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /> v
                {version}
              </span>
              <span className="rounded-full bg-brand-2 px-3 py-1.5 font-black text-ink">
                OPEN SOURCE · FREE
              </span>
              <span>Node {nodeVersion}</span>
              <span>MIT licensed</span>
            </div>
            <h1 className="max-w-[820px] font-display text-[clamp(4rem,7.5vw,7.05rem)] font-bold leading-[0.86] tracking-[-0.022em] text-fg">
              <span className="block whitespace-nowrap">CODE.</span>
              <span className="block whitespace-nowrap text-brand-2">COMMAND.</span>
              <span className="relative inline-block whitespace-nowrap text-brand">
                SHIP.
                <span className="absolute -right-5 -top-1 font-mono text-sm tracking-normal text-brand-2">
                  ↗
                </span>
              </span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
              WrongStack reads the repository, runs the tools and coordinates specialist agents
              under your rules. One open-source command center for serious software work—not blind
              automation.
            </p>
            <p className="mt-5 font-mono text-xs font-black uppercase tracking-[0.15em] text-fg sm:text-sm">
              <span className="text-brand-2">Built on the wrong stack.</span>{' '}
              <span className="text-brand">Shipped anyway.</span>
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <CopyCommand command={installCommand} />
              <Link
                href="/how-it-works"
                className="group inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold text-fg"
              >
                See how it works{' '}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
            <p className="mt-4 max-w-xl text-xs leading-6 text-faint">
              No paid runtime tier. No proprietary feature gate. Bring your own model provider;
              provider API usage may have its own cost.
            </p>
          </div>
          <div className="relative lg:mt-12">
            <div className="absolute -left-4 -top-5 z-10 hidden rotate-[-4deg] rounded-full bg-brand px-4 py-2 font-mono text-[10px] font-black uppercase tracking-widest text-white sm:block">
              Actual agent loop
            </div>
            <LiveRun />
          </div>
        </div>
        <div className="relative border-t border-line bg-surface/70">
          <div className="mx-auto grid max-w-[1380px] grid-cols-2 divide-x divide-line px-4 sm:px-6 lg:grid-cols-4 lg:px-10">
            {[
              ['58', 'built-in tools'],
              [String(commands.length), 'documented commands'],
              ['73', 'managed plugins'],
              ['5', 'first-class surfaces'],
            ].map(([value, label]) => (
              <div key={label} className="py-5 text-center sm:py-6">
                <strong className="font-mono text-xl text-fg sm:text-2xl">{value}</strong>
                <span className="ml-2 text-[11px] font-bold uppercase tracking-wider text-faint">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FleetTopologyPreview />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="01"
          eyebrow="Find your way"
          title="Everything useful is now one deliberate click away."
          description="Start with the question you have. Each path opens a focused guide with concrete concepts, commands and operating details."
        />
        <div className="mt-14 border-y border-line">
          {homeJourneys.map((journey) => (
            <Link
              key={journey.index}
              href={journey.href}
              className="journey-row group grid gap-4 border-b border-line py-7 last:border-b-0 sm:grid-cols-[70px_1fr_1fr_auto] sm:items-center lg:py-9"
            >
              <span className="font-mono text-xs font-black text-brand">{journey.index}</span>
              <h3 className="text-xl font-black tracking-[-0.035em] text-fg sm:text-2xl">
                {journey.title}
              </h3>
              <p className="max-w-xl text-sm leading-6 text-muted">{journey.body}</p>
              <span className="grid size-10 place-items-center rounded-full border border-line text-fg transition-all group-hover:border-brand group-hover:bg-brand group-hover:text-white">
                <ChevronRight className="size-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-ink text-white">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-32">
          <div className="grid gap-10 lg:grid-cols-[.55fr_1.2fr]">
            <div>
              <Eyebrow>One kernel</Eyebrow>
              <h2 className="text-4xl font-black leading-[1.02] tracking-[-0.025em] sm:text-5xl">
                Change the surface. Keep the system.
              </h2>
              <p className="mt-6 max-w-md text-base leading-7 text-zinc-400">
                The CLI, TUI, WebUI, Desktop and HQ do not reimplement the agent. They compose and
                observe the same contracts.
              </p>
              <Link
                href="/interfaces"
                className="group mt-8 inline-flex items-center gap-2 text-sm font-bold text-white"
              >
                Compare every interface{' '}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
            <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
              {surfaces.map((surface, index) => (
                <Reveal
                  key={surface.id}
                  delay={index * 0.04}
                  className="bg-[#0c0d12] p-6 last:sm:col-span-2 last:lg:col-span-1"
                >
                  <surface.icon className="size-5 text-brand" />
                  <h3 className="mt-6 text-lg font-black">{surface.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    {surface.tagline}. {surface.best}.
                  </p>
                  <code className="mt-5 block truncate font-mono text-[10px] text-zinc-600">
                    $ {surface.launch}
                  </code>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="02"
          eyebrow="Capability map"
          title="Batteries included. Boundaries included too."
          description="WrongStack is broad by design, but every capability enters through typed contracts, permission policy and observable execution."
        />
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {capabilityIndex.map(([title, body, slug], index) => (
            <Reveal key={title} delay={(index % 4) * 0.035} className="bg-card">
              <Link
                href={`/features/${slug}`}
                className="group block min-h-44 p-6 transition-colors hover:bg-surface"
              >
                <span className="font-mono text-[10px] font-black text-brand-2">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-8 text-base font-black tracking-[-0.025em] text-fg">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-faint transition-colors group-hover:text-brand">
                  Deep dive <ArrowRight className="size-3" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
        <div className="mt-10 flex justify-end">
          <Link
            href="/features"
            className="group inline-flex items-center gap-2 text-sm font-bold text-fg"
          >
            Explore every feature{' '}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[1380px] gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_.8fr] lg:items-center lg:px-10 lg:py-32">
          <div>
            <Eyebrow>Control is a feature</Eyebrow>
            <h2 className="max-w-3xl text-4xl font-black leading-[1.02] tracking-[-0.025em] text-fg sm:text-6xl">
              Fast when trusted. Explicit when it matters.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
              Every action has a policy. Hooks can narrow behavior, the Brain gates autonomous
              decisions, secrets stay encrypted and in-repo configuration is treated as
              attacker-controlled input.
            </p>
            <div className="mt-8 flex flex-wrap gap-6 text-sm font-semibold text-fg">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-500" /> Explicit deny survives YOLO
              </span>
              <span className="flex items-center gap-2">
                <CircleDollarSign className="size-4 text-brand-2" /> Token and cost budgets
              </span>
              <span className="flex items-center gap-2">
                <Users className="size-4 text-sky-500" /> Brain-gated fleet actions
              </span>
            </div>
            <Link
              href="/security"
              className="group mt-9 inline-flex items-center gap-2 text-sm font-bold text-brand"
            >
              Read the security model{' '}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
          <div className="relative">
            <div className="rounded-[28px] border border-line bg-bg p-5 shadow-xl shadow-black/5 sm:p-7">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <span className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-faint">
                  PreToolUse / bash
                </span>
                <span className="rounded-full bg-brand-2/10 px-2.5 py-1 font-mono text-[10px] font-bold text-brand-2">
                  CONFIRM
                </span>
              </div>
              <div className="mt-6 font-mono text-sm text-fg">
                <span className="text-brand">$</span> pnpm install new-dependency
              </div>
              <div className="mt-6 space-y-3">
                {[
                  'Hook filters passed',
                  'Input schema valid',
                  'Dependency install is mutating',
                  'Waiting for operator decision',
                ].map((line, index) => (
                  <div key={line} className="flex items-center gap-3 text-sm text-muted">
                    <span
                      className={
                        index < 3
                          ? 'grid size-5 place-items-center rounded-full bg-emerald-500/10 text-emerald-500'
                          : 'grid size-5 place-items-center rounded-full bg-brand-2/10 text-brand-2'
                      }
                    >
                      {index < 3 ? <Check className="size-3" /> : <Zap className="size-3" />}
                    </span>
                    {line}
                  </div>
                ))}
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <span className="rounded-xl border border-line px-4 py-3 text-center text-sm font-bold text-muted">
                  Deny
                </span>
                <span className="rounded-xl bg-fg px-4 py-3 text-center text-sm font-bold text-bg">
                  Allow once
                </span>
              </div>
            </div>
            <div className="absolute -bottom-5 -right-2 hidden items-center gap-2 rounded-full bg-brand px-4 py-2 font-mono text-[10px] font-black uppercase tracking-widest text-white sm:flex">
              <Layers3 className="size-3.5" /> 5 defense layers
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-[1380px] px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-10 lg:py-36">
          <Eyebrow>Run it locally</Eyebrow>
          <h2 className="mx-auto max-w-none text-[clamp(2.4rem,5vw,4.5rem)] font-black leading-[0.98] tracking-[-0.025em] text-fg lg:whitespace-nowrap">
            <span className="inline-block">Your code.</span>{' '}
            <span className="inline-block">Your keys.</span>{' '}
            <span className="inline-block text-brand">Your call.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
            Install the CLI, choose a provider or subscription, and start in the directory you
            already work in.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <CopyCommand command={installCommand} />
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-line bg-card px-5 py-3 text-sm font-bold text-fg hover:border-brand"
            >
              View on GitHub ↗
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
