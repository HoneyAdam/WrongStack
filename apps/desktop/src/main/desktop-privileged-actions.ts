import { randomUUID } from 'node:crypto';
import {
  createCompatibilityTrustBoundary,
  isTrustDecisionAllowed,
  type TrustBoundary,
  type TrustRisk,
  type TrustSubject,
} from '@wrongstack/core/security';

export const desktopCompatibilityTrustBoundary = createCompatibilityTrustBoundary({
  policyId: 'desktop-trusted-host-compat-v1',
});

export async function authorizeDesktopAction(
  boundary: TrustBoundary,
  action: {
    capability: string;
    subject: TrustSubject;
    risk: TrustRisk;
    cwd?: string | undefined;
    metadata?: Readonly<Record<string, string | number | boolean | null>> | undefined;
  },
): Promise<{ allowed: boolean; reason: string }> {
  const request = {
    version: 1 as const,
    requestId: randomUUID(),
    actor: { kind: 'user' as const, id: 'desktop-user' },
    surface: 'desktop' as const,
    capability: action.capability,
    subject: action.subject,
    risk: action.risk,
    scope: action.cwd ? { cwd: action.cwd } : {},
    authContext: { method: 'local-process' as const, principalId: 'desktop-user' },
    ...(action.metadata ? { metadata: action.metadata } : {}),
  };
  const decision = await boundary.evaluate(request);
  console.warn(
    JSON.stringify({
      level: 'info',
      event: 'desktop.trust_boundary.decision',
      requestId: request.requestId,
      capability: request.capability,
      decision: decision.kind,
      policyId: decision.policyId,
      timestamp: new Date().toISOString(),
    }),
  );
  return { allowed: isTrustDecisionAllowed(decision), reason: decision.reason };
}

export function authorizeDesktopRuntimeStart(
  boundary: TrustBoundary,
  cwd: string,
  runtimeKind: string,
): Promise<{ allowed: boolean; reason: string }> {
  return authorizeDesktopAction(boundary, {
    capability: 'process.spawn',
    subject: {
      kind: 'command',
      id: 'wrongstack-webui-runtime',
      attributes: { runtimeKind },
    },
    risk: 'high',
    cwd,
    metadata: { operation: 'open-project' },
  });
}

export function authorizeDesktopRuntimeStop(
  boundary: TrustBoundary,
  runtime: { id: string; pid?: number | undefined; root: string },
): Promise<{ allowed: boolean; reason: string }> {
  return authorizeDesktopAction(boundary, {
    capability: 'process.terminate',
    subject: {
      kind: 'process',
      id: String(runtime.pid ?? runtime.id),
      attributes: { runtimeId: runtime.id },
    },
    risk: 'high',
    cwd: runtime.root,
    metadata: { operation: 'close-runtime' },
  });
}
