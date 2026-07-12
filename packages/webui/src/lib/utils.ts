import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Browser-safe UUID generation. `crypto.randomUUID()` is only available in
 * secure contexts (HTTPS or localhost). In non-secure contexts (plain HTTP)
 * it is `undefined`, and calling it throws TypeError. This wrapper falls
 * back to a timestamp + Math.random combo when the API is unavailable.
 */
export function safeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
