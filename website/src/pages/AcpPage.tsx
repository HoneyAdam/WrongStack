import { ExternalDoc, PageHero, PageNext, SectionIntro } from '@/components/site/primitives';

export function AcpPage() {
  return (
    <>
      <PageHero index="20" eyebrow="ACP" title={<>Drive external agents{" "}<span className="text-brand">from one terminal.</span></>} description="Agent Communication Protocol lets WrongStack control external coding agents — Claude Code, Codex CLI, Gemini CLI — using their existing logins. No extra API keys, no configuration files." aside={<ExternalDoc path="docs/acp/README.md">Open ACP docs</ExternalDoc>} />

      <section className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
        <SectionIntro index="01" eyebrow="How it works" title="WrongStack becomes the conductor." description="ACP agents run as subprocesses. WrongStack sends tasks through stdio or WebSocket, translates tool calls, and collects results. Each agent uses its own tools, models, and permissions." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
          {[
            { step: '01', title: 'Discover', body: '/acp probe scans your system for installed ACP-capable agents. Results show agent name, transport type, and status.' },
            { step: '02', title: 'Dispatch', body: '/acp <agent> "task" sends work to one agent. /acp parallel <a>,<b> "task" fans to multiple. Each runs independently.' },
            { step: '03', title: 'Collect', body: 'Results stream back to WrongStack. Compare outputs side by side. Use /ensemble for structured multi-agent reviews.' },
          ].map(({ step, title, body }) => (
            <article key={step} className="bg-card p-7">
              <span className="font-mono text-xs font-black text-brand-2">{step}</span>
              <h2 className="mt-8 text-xl font-black text-fg">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1380px] px-4 py-20 sm:px-6 sm:py-28 lg:px-10">
          <SectionIntro index="02" eyebrow="Usage" title="One command to rule them all." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {[
              { cmd: '/acp', desc: 'List all discovered ACP agents with their transport and status.' },
              { cmd: '/acp probe', desc: 'Test connectivity to all installed agents. Reports reachability.' },
              { cmd: '/acp gemini-cli "review this module"', desc: 'Send a task to a specific agent by name.' },
              { cmd: '/acp parallel claude-code,codex-cli "review this diff"', desc: 'Fan out to multiple agents simultaneously.' },
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
        <SectionIntro index="03" eyebrow="Architecture" title="Transport layer and tool translation." description="ACP uses stdio or WebSocket to communicate with external agents. WrongStack translates its tool calls into the agent's native format." />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">Transport options</h2>
            <div className="mt-5 space-y-3">
              {[
                { label: 'Stdio', body: 'The agent runs as a child process. WrongStack sends JSON-RPC messages over stdin and reads responses from stdout. Lowest latency, simplest setup.' },
                { label: 'WebSocket', body: 'The agent connects via WebSocket to a WrongStack bridge. Useful when the agent runs on a different machine or inside a container.' },
                { label: 'Loopback bridge', body: 'For testing, a loopback transport lets you simulate ACP agent responses without installing external tools.' },
              ].map(({ label, body }) => (
                <div key={label} className="rounded-lg border border-line bg-bg p-4">
                  <h3 className="font-black text-sm text-fg">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-card p-7">
            <h2 className="text-xl font-black text-fg">Supported agents</h2>
            <div className="mt-5 space-y-3">
              {[
                { label: 'Claude Code', body: 'Anthropic\'s official CLI agent. Uses its own API key and tools. Full tool translation support.' },
                { label: 'Codex CLI (OpenAI)', body: 'OpenAI\'s open-source coding agent. Supports both stdio and WebSocket transport.' },
                { label: 'Gemini CLI (Google)', body: 'Google\'s CLI agent. Requires Gemini API access. Supports parallel ensemble dispatch.' },
                { label: 'Custom agents', body: 'Any tool that speaks the ACP v1 protocol can be registered. See the agent catalog at /acp for the full list.' },
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

      <PageNext label="Ensemble" title="Fan one task to multiple agents" body="Send the same problem to multiple ACP agents and compare their independent solutions." href="/ensemble" />
    </>
  );
}
