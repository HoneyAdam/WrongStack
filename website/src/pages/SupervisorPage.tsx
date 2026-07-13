import { Check, ShieldAlert, ShieldCheck } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function SupervisorPage() {
  return (
    <>
      <PageHero index="21" eyebrow="Fleet Supervisor" title={<>The Brain's{" "}<span className="text-brand">safety gate.</span></>} description="The Fleet Supervisor sits between the Director and every agent action. It evaluates spawns, assignments, and tool escalations against Brain risk thresholds — approving safe operations and blocking risky ones." aside={<ExternalDoc path="docs/slash/supervisor.md">Open Supervisor docs</ExternalDoc>} />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="How it works" title="Every fleet action passes through the gate." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
          {[
            { step: '01', icon: ShieldCheck, title: 'Evaluate', body: 'When the Director tries to spawn an agent or escalate a tool, the Supervisor checks the action against the Brain\'s current risk ceiling.' },
            { step: '02', icon: ShieldAlert, title: 'Approve or block', body: 'Safe actions pass through. Risky actions are blocked with a reason. The decision is logged for audit.' },
            { step: '03', icon: Check, title: 'Escalate if needed', body: 'For borderline cases, the Supervisor can escalate to an interactive prompt — you get the final say.' },
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
          <SectionIntro index="02" eyebrow="Commands" title="Status, enable, disable." />
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { cmd: '/supervisor status', desc: 'Show current state: enabled/disabled, recent decisions, blocked actions count.' },
              { cmd: '/supervisor on', desc: 'Enable the Supervisor. All fleet actions are now gated by Brain risk policy.' },
              { cmd: '/supervisor off', desc: 'Disable the Supervisor. Not recommended for production — bypasses Brain safety checks.' },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="rounded-xl border border-line bg-card p-5">
                <code className="font-mono text-sm font-black text-brand">{cmd}</code>
                <p className="mt-2 text-xs leading-5 text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="03" eyebrow="Decision flow" title="Deterministic policy first, LLM judgment second." description="The Supervisor does not call the model for every action. Fast deterministic rules handle the common cases; the Brain model only engages for borderline decisions." />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">What the Supervisor checks</h2>
            <div className="mt-5 space-y-3">
              {[
                { label: 'Agent spawns', body: 'Before a new subagent is created, the Supervisor verifies the spawn is within budget limits and risk thresholds.' },
                { label: 'Task assignments', body: 'Every task dispatch is checked: is the role appropriate? Does the task description match the agent\'s capabilities?' },
                { label: 'Tool escalations', body: 'When an agent requests a tool outside its default permission set, the Supervisor evaluates the escalation against Brain policy.' },
                { label: 'Budget exhaustion', body: 'Agents approaching their token, cost, or iteration caps trigger a pre-emptive review before the hard limit is hit.' },
              ].map(({ label, body }) => (
                <div key={label} className="rounded-lg border border-line bg-bg p-4">
                  <h3 className="font-black text-sm text-fg">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">Risk levels and escalation</h2>
            <div className="mt-5 space-y-3">
              {[
                { label: 'Low risk', body: 'Routine spawns and reads. Automatically approved. No Brain involvement.' },
                { label: 'Medium risk', body: 'Multi-file writes, worktree creation. Fast deterministic check, then approved if under ceiling.' },
                { label: 'High risk', body: 'Batch mutations, external network calls. Requires Brain model evaluation. May escalate to human.' },
                { label: 'Critical', body: 'Deletion of tracked files, permission policy changes. Always escalates to interactive human approval regardless of YOLO mode.' },
              ].map(({ label, body }) => (
                <div key={label} className="rounded-lg border border-line bg-bg p-4">
                  <h3 className="font-black text-sm text-fg">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <PageNext label="AutoPhase" title="Autonomous phased workflows" body="Let the agent plan, execute, and verify across worktrees — fully autonomous." href="/autophase" />
    </>
  );
}
