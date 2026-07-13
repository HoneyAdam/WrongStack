import { Bell, CheckCircle, Send } from 'lucide-react';
import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function TelegramPage() {
  return (
    <>
      <PageHero index="25" eyebrow="Telegram" title={<>Your agent{" "}<span className="text-brand">in your pocket.</span></>} description="Connect WrongStack to Telegram for push notifications, interactive approval prompts, and remote command delivery." aside={<ExternalDoc path="docs/telegram.md">Open Telegram docs</ExternalDoc>} />
      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="Capabilities" title="Three ways Telegram connects you to your agent." />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {[
            { icon: Bell, title: 'Notifications', body: 'Get alerts for task completion, errors, milestones, and budget warnings. Configurable per event type with quiet hours.' },
            { icon: CheckCircle, title: 'Approvals', body: 'The agent can send yes/no approval prompts to your Telegram chat. Approve or deny destructive operations, deploys, and config changes from anywhere.' },
            { icon: Send, title: 'Commands', body: 'Send commands to your agent through Telegram. The bot relays your message to the project mailbox where your agent picks it up.' },
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
          <SectionIntro index="02" eyebrow="Setup" title="Connect Telegram in two commands." />
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-card p-7">
              <h2 className="text-xl font-black text-fg">Initial setup</h2>
              <div className="mt-5 space-y-3">
                {[
                  { cmd: '/telegram-setup', desc: 'Guided wizard. Enter your bot token from @BotFather and default chat ID.' },
                  { cmd: '/telegram-settings test', desc: 'Send a test message to verify connectivity and permissions.' },
                ].map(({ cmd, desc }) => (<div key={cmd} className="rounded-lg border border-line bg-bg p-4"><code className="font-mono text-sm font-black text-brand">{cmd}</code><p className="mt-1.5 text-xs leading-5 text-muted">{desc}</p></div>))}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-7">
              <h2 className="text-xl font-black text-fg">Configuration</h2>
              <div className="mt-5 space-y-3">
                {[
                  { label: 'Event filters', body: 'Choose which events trigger notifications: task completion, errors, milestones, budget warnings, approval requests.' },
                  { label: 'Quiet hours', body: 'Suppress notifications during specified time windows. The agent still queues them for later delivery.' },
                  { label: 'Approval timeout', body: 'How long the agent waits for your response to an approval prompt before auto-denying. Default 60 seconds, max 10 minutes.' },
                ].map(({ label, body }) => (<div key={label} className="rounded-lg border border-line bg-bg p-4"><h3 className="font-black text-sm text-fg">{label}</h3><p className="mt-1 text-xs leading-5 text-muted">{body}</p></div>))}
              </div>
            </div>
          </div>
        </div>
      </section>
      <PageNext label="Collab debugging" title="BugHunter, RefactorPlanner, and Critic" body="Three agents run in parallel on your target files and produce a structured verdict." href="/collab" />
    </>
  );
}
