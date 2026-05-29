'use client';

import { cn } from '@/lib/utils';
import type { MouseEvent, ReactNode } from 'react';

/**
 * Card whose accent glow follows the pointer. The glow sits behind content
 * (z-0) so text stays crisp. Falls back to a plain card without a pointer.
 */
export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <div onMouseMove={onMove} className={cn('spotlight group relative overflow-hidden', className)}>
      <div className="spotlight-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
