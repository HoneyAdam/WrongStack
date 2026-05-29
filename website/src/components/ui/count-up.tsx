'use client';

import { useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * Counts up to the numeric part of `value` when scrolled into view.
 * Preserves any non-digit prefix/suffix (e.g. "~110", "600+").
 */
export function CountUp({
  value,
  className,
  duration = 900,
}: {
  value: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();

  const match = value.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);
  const prefix = match?.[1] ?? '';
  const target = match ? Number.parseFloat(match[2]) : 0;
  const suffix = match?.[3] ?? '';

  const [n, setN] = useState(reduce ? target : 0);

  useEffect(() => {
    if (reduce || !inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setN(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, target, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {Math.round(n)}
      {suffix}
    </span>
  );
}
