import { OPEN_EXTERNAL_ALLOWED_PROTOCOLS } from '../state/constants.js';

export function allowedExternalProtocol(target: string): string | undefined {
  try {
    const protocol = new URL(target).protocol;
    return OPEN_EXTERNAL_ALLOWED_PROTOCOLS.has(protocol) ? protocol : undefined;
  } catch {
    return undefined;
  }
}

export function sameOrigin(candidate: string, base: string | null): boolean {
  if (!base) return false;
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
