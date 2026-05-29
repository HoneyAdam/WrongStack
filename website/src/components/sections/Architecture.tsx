"use client"

import { Box, GitMerge, Radio, ShieldHalf, ArrowRight } from "lucide-react"
import { Reveal, SectionHeading } from "@/components/ui/reveal"

const primitives = [
  {
    icon: Box,
    name: "Container",
    body: "Typed DI keyed by a branded Token<T>. Bindings are factory, value, or decorator — lazy and memoized. Plugins rebind tokens before Agent.run.",
  },
  {
    icon: GitMerge,
    name: "Pipeline<T>",
    body: "Linear middleware chain. Six pipelines fire per step: userInput, request, response, assistantOutput, toolCall, contextWindow. Last replace wins.",
  },
  {
    icon: Radio,
    name: "EventBus",
    body: "Typed pub/sub across iteration, provider, tool, compaction, subagent, MCP and budget events. Listeners that throw are caught, never re-thrown.",
  },
  {
    icon: ShieldHalf,
    name: "RunController",
    body: "One per Agent.run. Owns the AbortController chain and runs cleanup hooks LIFO, so a cancelled run tears down in the right order.",
  },
]

const loop = [
  "normalize input",
  "build request",
  "provider call (+ retry)",
  "batch-execute tools",
  "compact if needed",
]

const packageMap = [
  { pkg: "packages/core", note: "Kernel + agent loop + default impls", dep: "depends on nothing internal" },
  { pkg: "packages/providers", note: "Anthropic · OpenAI · Google · OpenAI-compatible", dep: "→ core" },
  { pkg: "packages/tools", note: "read · write · bash · git · grep · …", dep: "→ core" },
  { pkg: "packages/mcp", note: "MCP client + registry + transports", dep: "→ core" },
  { pkg: "packages/runtime", note: "makeDefaultRuntime() wiring", dep: "→ core" },
  { pkg: "packages/cli · tui · webui", note: "REPL · Ink TUI · web front end", dep: "→ everything beneath" },
]

export function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Under the hood"
          title="A kernel you can"
          highlight="read in an afternoon"
          description="Four primitives in ~600 lines hold the whole runtime together. Layers only depend downward — and that direction is never reversed."
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {/* Kernel primitives */}
          <Reveal>
            <div className="h-full rounded-2xl border border-line bg-card p-6 sm:p-8">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-bold tracking-tight">Kernel primitives</h3>
                <span className="font-mono text-xs text-faint">≤600 LOC</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {primitives.map((p) => (
                  <div
                    key={p.name}
                    className="rounded-xl border border-line bg-surface p-4"
                  >
                    <div className="flex items-center gap-2 text-brand">
                      <p.icon className="size-4" />
                      <span className="font-mono text-sm font-semibold text-fg">
                        {p.name}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted">
                      {p.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Package map */}
          <Reveal delay={0.08}>
            <div className="h-full rounded-2xl border border-line bg-card p-6 sm:p-8">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-bold tracking-tight">
                  Packages & dependency direction
                </h3>
              </div>
              <ul className="mt-5 space-y-2.5 font-mono text-[13px]">
                {packageMap.map((p) => (
                  <li
                    key={p.pkg}
                    className="rounded-lg border border-line bg-surface px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3">
                      <span className="font-semibold text-fg">{p.pkg}</span>
                      <span className="text-brand">{p.dep}</span>
                    </div>
                    <p className="mt-0.5 font-sans text-xs text-muted">{p.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Agent loop */}
        <Reveal delay={0.1} className="mt-6">
          <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
            <h3 className="text-lg font-bold tracking-tight">The agent loop</h3>
            <p className="mt-1 text-sm text-muted">
              Each iteration, until the model stops asking for tools — then
              auto-compaction runs through the contextWindow pipeline.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
              {loop.map((step, i) => (
                <div key={step} className="flex items-center gap-2 sm:flex-1">
                  <div className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand/10 font-mono text-xs font-bold text-brand">
                      {i + 1}
                    </span>
                    <span className="font-mono text-xs text-fg">{step}</span>
                  </div>
                  {i < loop.length - 1 && (
                    <ArrowRight className="hidden size-4 shrink-0 text-faint sm:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
