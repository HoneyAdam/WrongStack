/**
 * fleet-pulse — formatter + signature unit tests.
 *
 * Pins: self-exclusion, null-when-alone, running-first ordering, agent and
 * char caps, and signature stability (counters/timestamps must NOT change
 * the signature; status/task changes MUST).
 */
import { describe, expect, it } from 'vitest';
import { buildFleetPulseBlock, fleetPulseSignature } from '../../src/core/fleet-pulse.js';
import type { MailboxAgentStatus } from '../../src/coordination/mailbox-types.js';

function status(over: Partial<MailboxAgentStatus> & { agentId: string }): MailboxAgentStatus {
  return {
    name: over.agentId.split('@')[0] ?? over.agentId,
    sessionId: 's1',
    status: 'running',
    iterations: 1,
    toolCalls: 2,
    lastActivityAt: '2026-07-04T10:00:00Z',
    lastSeenAt: '2026-07-04T10:00:00Z',
    online: true,
    ...over,
  } as MailboxAgentStatus;
}

describe('buildFleetPulseBlock', () => {
  it('returns null when the only online agent is self', () => {
    const block = buildFleetPulseBlock([status({ agentId: 'leader@aaaa' })], {
      selfId: 'leader@aaaa',
    });
    expect(block).toBeNull();
  });

  it('returns null when peers exist but are offline', () => {
    const block = buildFleetPulseBlock(
      [status({ agentId: 'leader@aaaa' }), status({ agentId: 'einstein@bbbb', online: false })],
      { selfId: 'leader@aaaa' },
    );
    expect(block).toBeNull();
  });

  it('lists peers with task/tool details, excluding self', () => {
    const block = buildFleetPulseBlock(
      [
        status({ agentId: 'leader@aaaa' }),
        status({
          agentId: 'einstein@aaaa',
          name: 'Einstein',
          role: 'Executor',
          currentTask: 'refactor auth module',
          currentTool: 'bash',
          toolCalls: 12,
        }),
        status({ agentId: 'curie@aaaa', name: 'Curie', status: 'idle', toolCalls: 0 }),
      ],
      { selfId: 'leader@aaaa' },
    );
    expect(block).not.toBeNull();
    const text = block?.text ?? '';
    expect(text).toContain('[FLEET PULSE] 2 peers online:');
    expect(text).toContain('• Einstein (Executor) — running — "refactor auth module" — tool: bash — 12 tools');
    expect(text).toContain('• Curie — idle');
    expect(text).not.toContain('leader');
    expect(text).toContain('[END FLEET PULSE]');
    // Running peers sort before idle ones.
    expect(text.indexOf('Einstein')).toBeLessThan(text.indexOf('Curie'));
  });

  it('truncates long task descriptions', () => {
    const block = buildFleetPulseBlock(
      [
        status({
          agentId: 'einstein@aaaa',
          name: 'Einstein',
          currentTask: 'x'.repeat(200),
        }),
      ],
      { selfId: 'leader@aaaa' },
    );
    expect(block?.text).toContain('…');
    expect(block?.text.length).toBeLessThan(400);
  });

  it('caps the number of listed agents and reports the remainder', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      status({ agentId: `agent${i}@aaaa`, name: `Agent${i}` }),
    );
    const block = buildFleetPulseBlock(many, { selfId: 'leader@aaaa', maxAgents: 5 });
    const text = block?.text ?? '';
    expect(text).toContain('… +15 more');
    expect((text.match(/• /g) ?? []).length).toBe(5);
  });

  it('enforces the character cap', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      status({
        agentId: `agent${i}@aaaa`,
        name: `Agent${i}`,
        currentTask: 'a fairly long task description here',
      }),
    );
    const block = buildFleetPulseBlock(many, { selfId: 'leader@aaaa', maxChars: 300 });
    expect((block?.text.length ?? 0)).toBeLessThanOrEqual(300);
    // Header must survive trimming.
    expect(block?.text).toContain('[FLEET PULSE]');
  });
});

describe('fleetPulseSignature', () => {
  it('is stable across counter/timestamp churn', () => {
    const a = [status({ agentId: 'e@a', iterations: 1, toolCalls: 2, lastSeenAt: 't1' })];
    const b = [status({ agentId: 'e@a', iterations: 99, toolCalls: 50, lastSeenAt: 't2' })];
    expect(fleetPulseSignature(a)).toBe(fleetPulseSignature(b));
  });

  it('changes when status or task changes', () => {
    const a = [status({ agentId: 'e@a', status: 'running', currentTask: 'x' })];
    const b = [status({ agentId: 'e@a', status: 'idle', currentTask: 'x' })];
    const c = [status({ agentId: 'e@a', status: 'running', currentTask: 'y' })];
    expect(fleetPulseSignature(a)).not.toBe(fleetPulseSignature(b));
    expect(fleetPulseSignature(a)).not.toBe(fleetPulseSignature(c));
  });

  it('is order-insensitive', () => {
    const x = status({ agentId: 'x@a' });
    const y = status({ agentId: 'y@a' });
    expect(fleetPulseSignature([x, y])).toBe(fleetPulseSignature([y, x]));
  });
});
