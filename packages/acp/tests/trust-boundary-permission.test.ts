import type { TrustBoundary, TrustBoundaryDecision } from '@wrongstack/core/security';
import { describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '../src/client/permission.js';
import {
  makeTrustBoundaryPermissionPolicy,
  toTrustBoundaryRequest,
} from '../src/client/trust-boundary-permission.js';

function request(
  rawInput: Record<string, unknown>,
  kind: 'edit' | 'execute' = 'edit',
): PermissionRequest {
  return {
    toolCall: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1' as never,
      title: 'Privileged callback',
      kind,
      status: 'pending',
      rawInput,
    },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
    signal: new AbortController().signal,
  };
}

describe('ACP TrustBoundary adapter', () => {
  it('maps filesystem callbacks to a scoped semantic request', () => {
    expect(
      toTrustBoundaryRequest(request({ path: '/project/file.ts', sessionId: 'session-1' }), {
        actor: { kind: 'subagent', id: 'agent-1' },
        scope: { projectId: 'project-1', cwd: '/project' },
      }),
    ).toEqual({
      version: 1,
      requestId: 'call-1',
      actor: { kind: 'subagent', id: 'agent-1', sessionId: 'session-1' },
      surface: 'acp',
      capability: 'filesystem.write',
      subject: { kind: 'path', id: '/project/file.ts', attributes: { toolKind: 'edit' } },
      risk: 'elevated',
      scope: { projectId: 'project-1', cwd: '/project', sessionId: 'session-1' },
      metadata: { title: 'Privileged callback', toolKind: 'edit' },
    });
  });

  it.each([
    [{ kind: 'allow', reason: 'policy allow' }, 'allow'],
    [{ kind: 'deny', reason: 'policy deny' }, 'reject'],
    [{ kind: 'confirm', reason: 'needs consent', prompt: 'Allow?' }, 'reject'],
    [
      {
        kind: 'scoped-token',
        reason: 'delegated',
        token: 'opaque',
        tokenId: 'token-1',
        expiresAt: '2026-07-21T16:00:00.000Z',
        capabilities: ['process.spawn'],
        scope: { cwd: '/project' },
      },
      'allow',
    ],
  ] satisfies Array<[TrustBoundaryDecision, string]>)(
    'maps $kind decisions to ACP option $1',
    async (decision, optionId) => {
      const boundary: TrustBoundary = { evaluate: vi.fn(async () => decision) };
      const policy = makeTrustBoundaryPermissionPolicy({ boundary });
      await expect(policy(request({ command: 'node' }, 'execute'))).resolves.toEqual({
        outcome: 'selected',
        optionId,
      });
    },
  );

  it('does not call the boundary after cancellation', async () => {
    const boundary: TrustBoundary = { evaluate: vi.fn() };
    const policy = makeTrustBoundaryPermissionPolicy({ boundary });
    const cancelled = request({ command: 'node' }, 'execute');
    const controller = new AbortController();
    controller.abort();
    cancelled.signal = controller.signal;
    await expect(policy(cancelled)).resolves.toEqual({ outcome: 'cancelled' });
    expect(boundary.evaluate).not.toHaveBeenCalled();
  });
});
