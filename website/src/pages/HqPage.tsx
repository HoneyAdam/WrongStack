import { Monitor, Radio, Webhook } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function HqPage() {
  return (
    <>
      <PageHero index="24" eyebrow="HQ Command Center" title={<>Orchestrate your fleet{" "}<span className="text-brand">from a browser.</span></>} description="HQ is a web-based control panel that connects to your WrongStack session. Operators can monitor fleet status, send steer prompts, and queue work — all through a browser." aside={<ExternalDoc path="docs/hq/README.md">Open HQ docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="How it works" title="Connect, monitor, steer." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { icon: Radio, title: 'Connect', body: 'Start HQ server with --hq flag. Agents connect via /hq connect <url>. The WebUI dashboard shows live fleet status, event streams, and cost breakdowns.' },
            { icon: Monitor, title: 'Monitor', body: 'HQ persists events and snapshots. View activity timelines, agent transcripts, budget consumption, and anomaly alerts in real time.' },
            { icon: Webhook, title: 'Steer', body: 'Operators send prompts through the web interface. Messages arrive in agent mailboxes as steer, btw, queue, or broadcast types.' },
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
          <SectionIntro index="02" eyebrow="Commands" title="Connect, disconnect, and monitor." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { cmd: '/hq', desc: 'Show connection status and the bound HQ server URL.' },
              { cmd: '/hq connect <url>', desc: 'Link this session to an HQ server at the given URL.' },
              { cmd: '/hq disconnect', desc: 'Sever the HQ connection. The session continues locally.' },
              { cmd: '/hq status', desc: 'Detailed view: active sessions, event throughput, uptime.' },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="rounded-xl border border-line bg-card p-5">
                <code className="font-mono text-sm font-black text-brand">{cmd}</code>
                <p className="mt-2 text-xs leading-5 text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <PageNext label="Telegram" title="Notifications and approvals in chat" body="Get agent alerts, request approvals, and send commands through Telegram." href="/telegram" />
    </>
  );
}
