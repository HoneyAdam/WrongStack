import { useState } from 'react';
import type { CodingConnection } from '@/data/coding-plans';
import { cn } from '@/lib/utils';

export function ConnectionLogo({
  connection,
  className,
}: {
  connection: CodingConnection;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn(
        'grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-white p-2.5 shadow-sm',
        className,
      )}
    >
      {failed ? (
        <span className="font-mono text-[10px] font-black uppercase tracking-[-0.08em] text-ink">
          {connection.vendor.slice(0, 2)}
        </span>
      ) : (
        <img
          src={connection.logoUrl}
          alt={connection.logoAlt}
          className="size-full object-contain"
          loading={connection.featured ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
