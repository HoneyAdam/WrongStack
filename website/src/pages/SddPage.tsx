import { Check, FileCode, Lightbulb } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function SddPage() {
  return (
    <>
      <PageHero index="18" eyebrow="SDD workflow" title={<>Spec first,{" "}<span className="text-brand">code second.</span></>} description="Spec-Driven Development turns a natural-language spec into a structured plan, implementation, and verification — all in one command. Each phase produces reviewable output before the next begins." aside={<ExternalDoc path="docs/slash/sdd.md">Open SDD docs</ExternalDoc>} />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="Phases" title="One command, three phases." description="/sdd takes your spec through plan → implement → verify. You review each phase before the agent proceeds." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
          {[
            { step: '01', icon: Lightbulb, title: 'Plan', body: 'The agent reads your spec and produces a structured implementation plan: files to create or modify, order of operations, dependencies, and risk assessment.' },
            { step: '02', icon: FileCode, title: 'Implement', body: 'With your approval, the agent executes the plan. It writes code, creates files, runs refactors — all with tool access governed by your permission policy.' },
            { step: '03', icon: Check, title: 'Verify', body: 'The agent runs tests, typechecks, linters, and any verification commands. A structured report shows pass/fail with remediation suggestions.' },
          ].map(({ step, icon: Icon, title, body }) => (
            <article key={step} className="bg-card p-7">
              <div className="flex items-center gap-3"><span className="font-mono text-xs font-black text-brand-2">{step}</span><Icon className="size-5 text-brand" /></div>
              <h2 className="mt-6 text-xl font-black text-fg">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Usage" title="Start with the smallest useful invocation." />
          <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-ink">
            {[
              { cmd: '/sdd "add OAuth account switching"', desc: 'Full workflow: plan, implement, verify. Best for well-understood features.' },
              { cmd: '/sdd status', desc: 'Check the current SDD phase state. Useful when resuming an interrupted workflow.' },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="flex items-start gap-4 border-b border-white/10 px-6 py-5 last:border-b-0">
                <span className="font-mono text-brand shrink-0 mt-0.5">❯</span>
                <div><code className="font-mono text-sm text-zinc-200">{cmd}</code><p className="mt-1 text-xs text-zinc-500">{desc}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="03" eyebrow="Difference from AutoPhase" title="SDD is interactive. AutoPhase is autonomous." description="SDD pauses between phases so you can review and steer. AutoPhase runs all phases without asking. Choose based on how much control you want." />
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">SDD</h2>
            <ul className="mt-4 space-y-2">
              {['You review each phase before it runs','Works in the current working tree','Ideal for focused, single-concern tasks','Phase state persists in the session'].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-muted"><Check className="mt-1 size-3.5 shrink-0 text-brand" />{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">AutoPhase</h2>
            <ul className="mt-4 space-y-2">
              {['Runs all phases without pausing','Uses git worktrees for isolation','Best for complex, multi-day efforts','Checkpoints enable rollback'].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-muted"><Check className="mt-1 size-3.5 shrink-0 text-brand" />{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="04" eyebrow="Commands" title="SDD subcommands and options." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { cmd: '/sdd "task"', desc: 'Start full SDD workflow with a spec string.' },
              { cmd: '/sdd status', desc: 'Check current phase and progress.' },
              { cmd: '/sdd --skip-plan "task"', desc: 'Skip planning and jump to implementation.' },
              { cmd: '/sdd --verify-only', desc: 'Run only verification against the current diff.' },
            ].map(({ cmd, desc }) => (<div key={cmd} className="rounded-xl border border-line bg-card p-5"><code className="font-mono text-sm font-black text-brand">{cmd}</code><p className="mt-2 text-xs leading-5 text-muted">{desc}</p></div>))}
          </div>
        </div>
      </section>

      <PageNext label="AutoPhase" title="Let the agent drive across worktrees" body="Fully autonomous phased work with worktree isolation, checkpoints, and rollback." href="/autophase" />
    </>
  );
}
