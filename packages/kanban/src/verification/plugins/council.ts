/**
 * Escalation plugin: council.
 * Delegates to a multi-perspective Council evaluation.
 * Council MUST produce backingRefs with concrete evidence.
 *
 * This is a PLACEHOLDER that records the contract. Actual Council dispatch
 * is handled by the Kanban tool or Director integration layer.
 */
import type { KanbanCheck, KanbanVerificationCheckResult } from '../../types.js';
import type { VerifierPlugin } from '../verifier-plugin.js';
import type { VerificationContext } from '../verification-context.js';

export class CouncilVerifierPlugin implements VerifierPlugin {
  readonly id = 'council';
  readonly kind = 'escalation' as const;

  canHandle(checkType: string): boolean {
    return checkType === 'council';
  }

  async verify(
    check: KanbanCheck,
    _context: VerificationContext,
  ): Promise<KanbanVerificationCheckResult> {
    // Placeholder — same contract as AgentVerifierPlugin but multi-perspective.
    return {
      checkId: check.id,
      description: check.description,
      type: check.type,
      status: 'skipped',
      evidence: {
        escalation: 'council',
        message:
          'This check requires council escalation. Dispatch a multi-perspective ' +
          'Council with the check description and collect a verdict with concrete ' +
          'backing evidence.',
      },
      error: 'Council escalation not yet dispatched.',
    };
  }
}
