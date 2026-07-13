import { Bug, Lightbulb, MessageSquare } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function CollabPage() {
  return (
    <>
      <PageHero index="26" eyebrow="Collab debugging" title={<>Three agents,{" "}<span className="text-brand">one verdict.</span></>} description="BugHunter finds bugs, RefactorPlanner proposes improvements, and Critic evaluates both — all running in parallel on your target files." aside={<ExternalDoc path="docs/slash/collab.md">Open Collab docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="The trio" title="BugHunter → RefactorPlanner → Critic" description="Three specialists work together. BugHunter emits bug.found events; RefactorPlanner listens and proposes refactors; Critic evaluates both streams and produces a final verdict." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { icon: Bug, title: 'BugHunter', body: 'Scans target files for bugs, anti-patterns, code smells, and security issues. Emits structured findings on the FleetBus.' },
            { icon: Lightbulb, title: 'RefactorPlanner', body: 'Listens for bug.found events and proposes concrete refactoring plans with affected file lists and risk estimates.' },
            { icon: MessageSquare, title: 'Critic', body: 'Evaluates both outputs and produces a structured report with overall verdict: approve, needs_revision, or reject.' },
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
          <SectionIntro index="02" eyebrow="FleetBus events" title="Agents talk to each other through typed events." description="The collaboration workflow uses the FleetBus for real-time inter-agent communication. Each agent emits structured events that the others consume." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { cmd: 'bug.found', desc: 'BugHunter emits when it finds a bug. Payload: file, line, severity, description.' },
              { cmd: 'refactor.plan', desc: 'RefactorPlanner emits after receiving bug.found. Payload: affected files, risk estimate, approach.' },
              { cmd: 'critic.evaluation', desc: 'Critic emits the final verdict. Payload: overall (approve/needs_revision/reject), per-finding analysis.' },
              { cmd: '/collab src/auth/', desc: 'Run the trio on a specific directory. Add --timeout for longer analysis windows.' },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="rounded-xl border border-line bg-card p-5">
                <code className="font-mono text-sm font-black text-brand">{cmd}</code>
                <p className="mt-2 text-xs leading-5 text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <PageNext label="GitHub Sync" title="Keep machines in sync" body="Sync settings, skills, prompts, and memory across machines through GitHub." href="/sync" />
    </>
  );
}
