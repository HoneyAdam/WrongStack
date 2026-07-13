import { cn } from '@/lib/utils';

type BrandMarkProps = {
  className?: string;
  title?: string;
};

/** The canonical five-block WrongStack mark. */
export function BrandMark({ className, title }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 340 90"
      className={cn('h-auto w-14 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      shapeRendering="crispEdges"
    >
      {title && <title>{title}</title>}
      <path fill="#FD9F02" d="M0 0h60v60H0zM140 0h60v60h-60zM210 0h60v60h-60zM280 0h60v60h-60z" />
      <path fill="#FE2E5F" d="M70 30h60v60H70z" />
    </svg>
  );
}
