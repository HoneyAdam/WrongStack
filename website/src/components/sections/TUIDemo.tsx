'use client';

import { Reveal, SectionHeading } from '@/components/ui/reveal';
import { Out, Prompt, TerminalFrame } from '@/components/ui/terminal';
import { useInView, useReducedMotion } from 'framer-motion';
import { RotateCw } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

type Line = { id: string; delay: number; node: ReactNode };

const script: Line[] = [
  { id: 'cmd', delay: 0, node: <Prompt>wstack --director "audit src/ for security issues"</Prompt> },
  {
    id: 'roster',
    delay: 500,
    node: <Out tone="blue">▸ Director mode — fleet roster loaded (46 roles)</Out>,
  },
  {
    id: 'spawn-1',
    delay: 350,
    node: (
      <span className="text-zinc-400">
        [spawn] <Out tone="purple">security-scanner</Out> #1
      </span>
    ),
  },
  {
    id: 'spawn-2',
    delay: 250,
    node: (
      <span className="text-zinc-400">
        [spawn] <Out tone="purple">bug-hunter</Out> #2
      </span>
    ),
  },
  {
    id: 'assign-1',
    delay: 350,
    node: <span className="text-zinc-400">[assign] #1 ← scan src/ for injection + secrets</span>,
  },
  {
    id: 'assign-2',
    delay: 250,
    node: <span className="text-zinc-400">[assign] #2 ← review the auth flow</span>,
  },
  { id: 'decide', delay: 500, node: <Out tone="yellow">⟳ DECIDE — 2 tasks queued</Out> },
  { id: 'execute', delay: 700, node: <Out tone="blue">⚡ EXECUTE — #1 grep, read ×12 · #2 read ×6</Out> },
  { id: 'reflect', delay: 900, node: <Out tone="purple">◎ REFLECT — 3 findings rolled up</Out> },
  { id: 'done', delay: 600, node: <Out tone="green">✓ fleet done · 2 subagents · $0.07</Out> },
];

export function TUIDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, margin: '-120px' });
  const [count, setCount] = useState(0);
  const [runId, setRunId] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runId is a replay trigger — bumping it restarts the animation even though it isn't read here.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reduce) {
      setCount(script.length);
      return;
    }
    if (!inView) return;
    setCount(0);
    let acc = 0;
    script.forEach((line, i) => {
      acc += line.delay;
      timers.current.push(setTimeout(() => setCount(i + 1), acc));
    });
    return () => timers.current.forEach(clearTimeout);
  }, [inView, runId, reduce]);

  const done = count >= script.length;

  return (
    <section id="demo" className="scroll-mt-20 border-t border-line bg-surface/40 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Watch it run"
          title="A Director fleet,"
          highlight="start to finish"
          description="Promote the session to Director, fan work out to specialist subagents, and watch the decide → execute → reflect cycle close — all from one command."
        />

        <Reveal className="mx-auto mt-12 max-w-3xl">
          <div ref={ref}>
            <TerminalFrame
              title="wrongstack — director"
              right={
                <button
                  type="button"
                  onClick={() => setRunId((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                >
                  <RotateCw className={done ? 'size-3.5' : 'size-3.5 animate-spin'} />
                  replay
                </button>
              }
            >
              <div className="min-h-[260px] space-y-1.5">
                {script.slice(0, count).map((line) => (
                  <div key={`${runId}-${line.id}`} className="animate-[fadeIn_0.3s_ease]">
                    {line.node}
                  </div>
                ))}
                {!done && <span className="caret" />}
              </div>
            </TerminalFrame>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
