'use client';

import { cn } from '@/lib/utils';
import { type ReactNode, useEffect, useRef } from 'react';

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
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const onMove = (event: MouseEvent) => {
      const bounds = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
      card.style.setProperty('--my', `${event.clientY - bounds.top}px`);
    };
    card.addEventListener('mousemove', onMove);
    return () => card.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div ref={cardRef} className={cn('spotlight group relative overflow-hidden', className)}>
      <div className="spotlight-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
