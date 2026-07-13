import { Activity, AlertTriangle, Bell, Zap } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function ShadowAgentPage() {
  return (
    <>
      <PageHero index="19" eyebrow="Shadow Agent" title={<>Watch every agent{" "}<span className="text-brand">without getting in the way.</span></>} description="The Shadow Agent is a background fleet monitor. It observes heartbeats, detects stuck agents, tracks spike tasks, and alerts you to anomalies — silently, on a cron schedule." aside={<ExternalDoc path="docs/shadow-agent.md">Open Shadow Agent docs</ExternalDoc>} />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="Responsibilities" title="Silent observation, actionable alerts." />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {[
            { icon: Activity, title: 'Heartbeat monitoring', body: 'Every 30 seconds (configurable), the Shadow checks every agent\'s heartbeat. Agents unresponsive for 5 minutes are flagged as stuck.' },
            { icon: Zap, title: 'Spike detection', body: 'Tracks agents that spawn and die within seconds. Spike patterns often indicate configuration errors or tool permission problems.' },
            { icon: Bell, title: 'Mailbox surveillance', body: 'Monitors all mailbox traffic — direct messages, broadcasts, assignments. Flags orphan tasks (assign without result) and stale asks.' },
            { icon: AlertTriangle, title: 'Anomaly detection', body: 'Classifies anomalies: stuck_agent, spike_task, mailbox_loop, budget_exhausted. Each gets a severity rating and description.' },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-line bg-card p-6">
              <Icon className="size-5 text-brand" /><h2 className="mt-4 text-lg font-black text-fg">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Commands" title="Start, inspect, and stop." />
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { cmd: '/shadow start', desc: 'Launch the Shadow Agent. It begins heartbeat monitoring on its configured interval.' },
              { cmd: '/shadow status', desc: 'Print a fleet snapshot: tracked agents, recent anomalies, mailbox summary.' },
              { cmd: '/shadow stop', desc: 'Deactivate the Shadow. All cron jobs are cancelled, state is persisted.' },
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
        <SectionIntro index="03" eyebrow="Configuration" title="Tune the Shadow to your fleet size." description="Adjust interval, thresholds, and auto-intervention behavior through the Shadow state." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { label: 'Interval', cmd: 'shadow_interval_ms', body: 'Heartbeat check frequency. Default 30 000 ms (30 s). Lower for faster detection, higher for less overhead.' },
            { label: 'Stuck threshold', cmd: 'shadow_stuck_threshold_ms', body: 'How long an agent can be silent before being flagged as stuck. Default 300 000 ms (5 min).' },
            { label: 'Spike threshold', cmd: 'shadow_spike_threshold_ms', body: 'Maximum task duration that counts as a spike. Tasks completing faster than this are flagged. Default 5 000 ms.' },
            { label: 'Auto-intervene', cmd: 'shadow_auto_intervene', body: 'When enabled, the Shadow automatically terminates agents that exceed thresholds. Default false (report only).' },
            { label: 'Model', cmd: 'shadow_model', body: 'The LLM used for pattern analysis. Defaults to the session model. Set with /setmodel for lighter analysis.' },
            { label: 'Intervention log', cmd: '/shadow status', body: 'Every intervention (hoop, terminate) is logged with timestamp, target, and result for audit.' },
          ].map(({ label, cmd, body }) => (
            <div key={label} className="rounded-xl border border-line bg-card p-5">
              <h3 className="font-black text-sm text-fg">{label}</h3>
              <code className="mt-2 block font-mono text-[10px] text-brand">{cmd}</code>
              <p className="mt-2 text-xs leading-5 text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <PageNext label="ACP" title="Drive external coding agents from WrongStack" body="Discover and run Claude Code, Codex CLI, Gemini CLI and more using their existing logins." href="/acp" />
    </>
  );
}
