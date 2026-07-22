import type { HqCommand } from '@wrongstack/core/hq';
import { isTrustDecisionAllowed, type TrustBoundary, type TrustBoundaryRequest } from '@wrongstack/core/security';
import type { ConnectedClient } from './types.js';

export async function authorizeHqCommand(input: {
  boundary: TrustBoundary;
  command: HqCommand;
  commandId: string;
  enqueuedBy: string;
  authMethod: 'session' | 'bearer-token';
  target: ConnectedClient;
}): Promise<{ allowed: boolean; reason: string }> {
  const { boundary, command, commandId, enqueuedBy, authMethod, target } = input;
  const subject =
    command.type === 'run-command'
      ? {
          kind: 'command' as const,
          id: command.command,
          attributes: { targetClientId: target.clientId },
        }
      : {
          kind: 'custom' as const,
          id: command.type,
          attributes: { targetClientId: target.clientId },
        };
  const request: TrustBoundaryRequest = {
    version: 1,
    requestId: commandId,
    // This request is initiated by the authenticated HQ operator. Browser and
    // target-client capability checks have already passed before this adapter
    // is called, so classifying it as an unauthenticated remote client would
    // make the compatibility policy deny every legitimate run-command.
    actor: { kind: 'user', id: enqueuedBy },
    surface: 'hq',
    capability: command.type === 'run-command' ? 'hq.control.execute' : 'hq.control.enqueue',
    subject,
    risk: command.type === 'run-command' ? 'critical' : 'high',
    scope: { projectId: target.projectId },
    authContext: { method: authMethod, principalId: enqueuedBy },
    metadata: { commandType: command.type, targetKind: target.kind },
  };
  const decision = await boundary.evaluate(request);
  console.warn(
    JSON.stringify({
      level: 'info',
      event: 'hq.trust_boundary.decision',
      requestId: commandId,
      capability: request.capability,
      decision: decision.kind,
      policyId: decision.policyId,
      actor: enqueuedBy,
      clientId: target.clientId,
      timestamp: new Date().toISOString(),
    }),
  );
  return { allowed: isTrustDecisionAllowed(decision), reason: decision.reason };
}
