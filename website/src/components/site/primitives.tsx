import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check, Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { docsUrl, repoUrl } from '@/data/content';
import { Link } from '@/lib/router';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-brand-2">
      <span className="h-px w-8 bg-brand-2" />
      {children}
    </div>
  );
}

export function PageHero({
  index,
  eyebrow,
  title,
  description,
  aside,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line pt-28 sm:pt-32 lg:pt-40">
      <div className="manual-grid absolute inset-0 opacity-70" aria-hidden="true" />
      <BrandMark className="pointer-events-none absolute right-[4%] top-28 w-36 opacity-[0.08] sm:w-48 lg:top-36 lg:w-60" />
      <div className="relative mx-auto max-w-[1380px] px-4 pb-16 sm:px-6 sm:pb-20 lg:px-10 lg:pb-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,.55fr)] lg:items-end">
          <div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs font-black text-faint">{index}</span>
              <span className="h-px w-12 bg-line-strong" />
              <span className="font-mono text-xs font-black uppercase tracking-[0.2em] text-brand">
                {eyebrow}
              </span>
            </div>
            <h1 className="mt-8 max-w-5xl font-display text-[clamp(3.25rem,7.4vw,7.15rem)] font-bold leading-[0.92] tracking-[-0.028em] text-fg">
              {title}
            </h1>
          </div>
          <div className="border-l-2 border-brand pl-5 lg:mb-1">
            <p className="text-base leading-7 text-muted sm:text-lg">{description}</p>
            {aside && <div className="mt-6">{aside}</div>}
          </div>
        </div>
      </div>
      <div className="signal-line absolute inset-x-0 bottom-0" aria-hidden="true" />
    </section>
  );
}

export function SectionIntro({
  index,
  eyebrow,
  title,
  description,
  className,
}: {
  index?: string;
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-6 border-t border-line pt-7 lg:grid-cols-[.38fr_1fr]', className)}>
      <div className="flex gap-3 font-mono text-[11px] font-black uppercase tracking-[0.18em] text-faint">
        {index && <span className="text-brand-2">{index}</span>}
        {eyebrow}
      </div>
      <div>
        <h2 className="max-w-4xl text-3xl font-black leading-tight tracking-[-0.025em] text-fg sm:text-4xl lg:text-5xl">
          {title}
        </h2>
        {description && (
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted sm:text-lg">{description}</p>
        )}
      </div>
    </div>
  );
}

export function ArrowLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn('group inline-flex items-center gap-2 text-sm font-bold text-fg', className)}
    >
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

export function ExternalDoc({ path, children }: { path?: string; children: ReactNode }) {
  const href = path ? `${repoUrl}/blob/main/${path}` : docsUrl;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline"
    >
      {children}{' '}
      <ArrowUpRight className="size-3.5 text-brand-2 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  return (
    <div className="inline-flex max-w-full items-center gap-3 rounded-full border border-line bg-card py-1.5 pl-4 pr-1.5 shadow-sm">
      {label && <span className="hidden text-xs font-semibold text-muted sm:inline">{label}</span>}
      <code className="truncate font-mono text-xs font-bold text-fg sm:text-sm">{command}</code>
      <button
        type="button"
        onClick={copy}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-fg text-bg"
        aria-label={copied ? 'Copied' : `Copy ${command}`}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18 }}
      whileInView={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function PageNext({
  label,
  title,
  body,
  href,
}: {
  label: string;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <section className="border-t border-line bg-surface">
      <Link
        href={href}
        className="group mx-auto grid max-w-[1380px] gap-6 px-4 py-14 sm:px-6 lg:grid-cols-[.4fr_1fr_auto] lg:items-center lg:px-10 lg:py-20"
      >
        <span className="font-mono text-[11px] font-black uppercase tracking-[0.2em] text-brand-2">
          Next / {label}
        </span>
        <div>
          <h2 className="text-3xl font-black tracking-[-0.025em] text-fg sm:text-4xl">{title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{body}</p>
        </div>
        <span className="grid size-14 place-items-center rounded-full border border-line bg-bg text-fg transition-all group-hover:translate-x-1 group-hover:border-brand-2 group-hover:bg-brand-2 group-hover:text-ink">
          <ArrowRight className="size-5" />
        </span>
      </Link>
    </section>
  );
}
