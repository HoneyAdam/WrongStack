import { ArrowDown, Bot, Check, Gauge, Search, Sparkles, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';
import {
  builtInRosterCount,
  extendedRosterCount,
  externalAcpAgents,
  rosterPhases,
  specialRosterAgents,
} from '@/data/product-catalog';
import { Link } from '@/lib/router';
import { cn } from '@/lib/utils';

export function AgentRosterPage() {
  const [phase, setPhase] = useState('all');
  const [query, setQuery] = useState('');
  const visiblePhases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rosterPhases
      .filter((item) => phase === 'all' || item.id === phase)
      .map((item) => ({
        ...item,
        agents: item.agents.filter((agent) => {
          if (!needle) return true;
          return `${agent.role} ${agent.name} ${agent.summary} ${agent.budget}`
            .toLowerCase()
            .includes(needle);
        }),
      }))
      .filter((item) => item.agents.length > 0);
  }, [phase, query]);

  const visibleCount = visiblePhases.reduce((total, item) => total + item.agents.length, 0);

  return (
    <>
      <PageHero
        index="18"
        eyebrow="Agent roster"
        title={
          <>
            Fifty-one roles.
            <br />
            <span className="text-brand-2">One accountable fleet.</span>
          </>
        }
        description="WrongStack does not clone one generic worker 51 times. Each role has its own capability signals, prompt, tool scope and budget profile; smart dispatch uses those contracts to send bounded work to the right specialist."
        aside={
          <ExternalDoc path="docs/slash/fleet.md">Open the fleet operator reference</ExternalDoc>
        }
      />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="01"
          eyebrow="Current source count"
          title="The old 47-agent number is no longer current."
          description="The live FLEET_ROSTER resolves 50 phase-catalog roles plus the Shadow operational role. Five optional ACP agents extend the addressable catalog without entering the in-process roster."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            [String(builtInRosterCount), 'Built-in roles', 'FLEET_ROSTER'],
            ['9', 'Lifecycle phases', 'discovery → meta'],
            [String(externalAcpAgents.length), 'External ACP agents', 'own runtimes'],
            [String(extendedRosterCount), 'Extended total', 'FLEET_ROSTER_WITHACP'],
          ].map(([value, label, code]) => (
            <div key={label} className="bg-card p-7">
              <strong className="font-mono text-3xl font-black text-brand-2">{value}</strong>
              <h2 className="mt-5 font-black text-fg">{label}</h2>
              <code className="mt-2 block font-mono text-[9px] text-faint">{code}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro
            index="02"
            eyebrow="Smart dispatch"
            title="A task becomes a role through an explainable route."
          />
          <div className="mt-12 space-y-2">
            {[
              [
                'Describe',
                'The leader supplies a bounded task and its completion evidence.',
                'task text',
              ],
              [
                'Score',
                'Capability keywords score every candidate deterministically and instantly.',
                'keywords → role score',
              ],
              [
                'Classify',
                'When the heuristic is ambiguous, an optional LLM classifier chooses among exact role ids.',
                'exact role id',
              ],
              [
                'Materialize',
                'The role contributes its prompt, scoped tools and workload budget profile.',
                'SubagentConfig',
              ],
              [
                'Route model',
                'The model matrix resolves exact role, phase, wildcard and finally leader defaults.',
                'role → phase → * → leader',
              ],
              [
                'Return evidence',
                'submit_result sends findings, files, confidence and next steps back to the leader.',
                'TaskResult.report',
              ],
            ].map(([title, body, code], index) => (
              <div key={title}>
                <article className="grid gap-5 rounded-2xl border border-line bg-card p-6 sm:grid-cols-[52px_180px_1fr_220px] sm:items-center">
                  <span className="grid size-11 place-items-center rounded-full border border-line bg-bg font-mono text-xs font-black text-brand-2">
                    0{index + 1}
                  </span>
                  <h2 className="font-black text-fg">{title}</h2>
                  <p className="text-sm leading-7 text-muted">{body}</p>
                  <code className="font-mono text-[10px] text-brand">{code}</code>
                </article>
                {index < 5 && <ArrowDown className="mx-auto my-1 size-4 text-faint" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="03"
          eyebrow="Roster atlas"
          title="Every phase and every built-in specialist."
          description="Filter by lifecycle phase or search by a capability. Each card shows the exact role id accepted by fleet and delegate commands."
        />
        <label className="relative mt-10 block">
          <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try: auth, browser, release, cost, security…"
            className="h-12 w-full rounded-full border border-line bg-card pl-11 pr-4 text-sm text-fg outline-none focus:border-brand-2"
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {[['all', 'All'], ...rosterPhases.map((item) => [item.id, item.label] as const)].map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPhase(id)}
                className={cn(
                  'rounded-full border px-3.5 py-2 font-mono text-[9px] font-black uppercase tracking-[0.12em] transition-colors',
                  phase === id
                    ? 'border-brand-2 bg-brand-2 text-ink'
                    : 'border-line bg-card text-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {visibleCount} matching phase-catalog roles
        </p>

        <div className="mt-8 space-y-14">
          {visiblePhases.map((item, phaseIndex) => (
            <div key={item.id}>
              <div className="grid gap-3 sm:grid-cols-[70px_180px_1fr] sm:items-end">
                <span className="font-mono text-xs font-black text-brand-2">
                  {String(phaseIndex + 1).padStart(2, '0')}
                </span>
                <h2 className="text-2xl font-black tracking-[-0.04em] text-fg">{item.label}</h2>
                <p className="text-sm leading-6 text-muted">{item.purpose}</p>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {item.agents.map((agent) => (
                  <article key={agent.role} className="rounded-2xl border border-line bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <code className="font-mono text-xs font-black text-brand">
                          {agent.role}
                        </code>
                        <h3 className="mt-2 text-xl font-black text-fg">{agent.name}</h3>
                      </div>
                      <Bot className="size-5 text-faint" />
                    </div>
                    <p className="mt-4 min-h-16 text-sm leading-7 text-muted">{agent.summary}</p>
                    <div className="mt-5 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-wider text-faint">
                      <span className="rounded-full border border-line bg-bg px-2.5 py-1">
                        {agent.tools} tools
                      </span>
                      <span className="rounded-full border border-line bg-bg px-2.5 py-1">
                        {agent.budget}
                      </span>
                    </div>
                    <code className="mt-5 block overflow-x-auto rounded-lg bg-ink px-3 py-2 font-mono text-[10px] text-zinc-300">
                      /fleet spawn {agent.role}
                    </code>
                  </article>
                ))}
              </div>
            </div>
          ))}
          {visiblePhases.length === 0 && (
            <div className="rounded-2xl border border-line bg-card py-16 text-center text-sm text-muted">
              No roster role matches this phase and search.
            </div>
          )}
        </div>
      </section>

      <section className="border-y border-line bg-ink text-white">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro
            index="04"
            eyebrow="Beyond the nine phases"
            title="Operational shadow plus five external agent runtimes."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-[.55fr_1fr]">
            {specialRosterAgents.map((agent) => (
              <article
                key={agent.role}
                className="rounded-2xl border border-brand/25 bg-brand/5 p-7"
              >
                <Sparkles className="size-5 text-brand" />
                <code className="mt-8 block font-mono text-xs text-brand">{agent.role}</code>
                <h2 className="mt-3 text-2xl font-black">{agent.name}</h2>
                <p className="mt-4 text-sm leading-7 text-zinc-400">{agent.summary}</p>
                <code className="mt-6 block font-mono text-[10px] text-zinc-500">
                  /shadow start · /fleet spawn shadow-agent
                </code>
              </article>
            ))}
            <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
              {externalAcpAgents.map((agent) => (
                <article key={agent.role} className="bg-[#0c0d12] p-6">
                  <span className="font-mono text-[9px] font-black uppercase tracking-wider text-zinc-600">
                    external ACP
                  </span>
                  <h2 className="mt-5 font-black">{agent.name}</h2>
                  <code className="mt-3 block font-mono text-[10px] text-brand">{agent.role}</code>
                  <p className="mt-4 font-mono text-[9px] text-zinc-600">{agent.runtime}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro
          index="05"
          eyebrow="Boundaries"
          title="Role presets are defaults, not an invisible prison."
          description="A roster entry supplies the smallest useful starting contract. Explicit delegate options and model routing can still specialize one task."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
          {[
            [
              Gauge,
              'Budget profile',
              'Light, medium, heavy or a bounded single-shot validator profile.',
            ],
            [
              Workflow,
              'Tool allowlist',
              'Planning and review stay read-oriented; builders receive mutation and verification tools.',
            ],
            [
              Sparkles,
              'Model matrix',
              'Provider, model, fallback and reasoning can resolve by exact role or phase.',
            ],
            [
              Bot,
              'Lifecycle',
              'A 15-minute activity watchdog reaps stalls; productive work is not killed by a default wall clock.',
            ],
          ].map(([Icon, title, body]) => {
            const ItemIcon = Icon as typeof Gauge;
            return (
              <article key={String(title)} className="bg-card p-6">
                <ItemIcon className="size-5 text-brand" />
                <h2 className="mt-8 font-black text-fg">{String(title)}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{String(body)}</p>
              </article>
            );
          })}
        </div>
        <div className="mt-8 flex flex-wrap gap-5">
          <Link href="/commands/fleet" className="text-sm font-black text-brand">
            Operate with /fleet →
          </Link>
          <Link href="/commands/delegate" className="text-sm font-black text-brand">
            Delegate one task →
          </Link>
          <Link href="/commands/setmodel" className="text-sm font-black text-brand">
            Route models by role →
          </Link>
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <Check className="mt-1 size-4 shrink-0 text-emerald-500" />
          <p className="text-sm leading-7 text-muted">
            Use <code className="font-mono text-xs text-brand">/fleet dispatch &lt;task&gt;</code>{' '}
            when you want routing, or{' '}
            <code className="font-mono text-xs text-brand">/fleet spawn &lt;role&gt;</code> when you
            already know the specialist.
          </p>
        </div>
      </section>

      <PageNext
        label="Fleet & Brain"
        title="See how the Director turns roles into accountable work"
        body="Continue into tasks, budgets, supervision, structured results and Brain governance."
        href="/fleet"
      />
    </>
  );
}
