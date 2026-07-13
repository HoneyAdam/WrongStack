import { GitCompare, Layers3, Zap } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function EnsemblePage() {
  return (
    <>
      <PageHero index="23" eyebrow="Ensemble" title={<>Multiple agents,{" "}<span className="text-brand">one problem.</span></>} description="Fan one task to multiple ACP-capable coding agents simultaneously. Each works independently. Compare results side by side or use voting for consensus." aside={<ExternalDoc path="docs/slash/ensemble.md">Open Ensemble docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="How it works" title="Parallel execution, unified results." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { icon: Layers3, title: 'Parallel dispatch', body: 'The same task is sent to every selected ACP agent. Each agent runs in its own process with its own tools, models, and context.' },
            { icon: GitCompare, title: 'Side-by-side comparison', body: 'Results are collected and presented together. Spot disagreements, identify blind spots, and see which agent found what.' },
            { icon: Zap, title: 'Voting and consensus', body: 'For review tasks, ensemble can run a voting pass — multiple agents independently assess the same code and surface agreement patterns.' },
          ].map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border border-line bg-card p-7">
              <Icon className="size-5 text-brand" /><h2 className="mt-8 text-xl font-black text-fg">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Use cases" title="When to ensemble vs. when to delegate." />
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {[
              { title: 'Code review', body: 'Send the same diff to multiple agents. Each finds different issues. Ensemble surfaces the overlap and the unique findings.' },
              { title: 'Architecture decisions', body: 'Pose a design question to multiple agents with different reasoning styles. Compare their recommendations side by side.' },
              { title: 'Bug investigation', body: 'When root cause is unclear, let multiple agents independently investigate. Cross-reference their findings for consensus.' },
            ].map(({ title, body }) => (
              <article key={title} className="rounded-2xl border border-line bg-card p-7">
                <h2 className="text-xl font-black text-fg">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <PageNext label="HQ Command Center" title="Remote fleet orchestration" body="A web-based control panel for monitoring and steering your fleet from anywhere." href="/hq" />
    </>
  );
}
