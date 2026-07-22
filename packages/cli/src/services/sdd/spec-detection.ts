import { sddState } from './state.js';

/**
 * Returns true if the text looks like conversational/explanatory output
 * rather than a structured implementation plan.
 */
export function isExplanatoryText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.startsWith("i'") ||
    lower.startsWith('i will') ||
    lower.startsWith('let me') ||
    lower.startsWith("here's my") ||
    lower.startsWith('here is my') ||
    lower.startsWith("i'm going to") ||
    lower.startsWith('first, let me') ||
    lower.startsWith('sure') ||
    lower.startsWith('of course') ||
    lower.startsWith('okay') ||
    lower.startsWith('ok,') ||
    lower.startsWith('sounds good') ||
    lower.startsWith('no problem') ||
    (text.split('\n').length < 3 && !text.includes('.'))
  );
}

/**
 * Parse a spec from AI output text and save it to the active session.
 * Returns true if a spec was found and saved.
 */
export async function trySaveSpecFromAIOutput(aiOutput: string): Promise<boolean> {
  const builder = sddState.getBuilder();
  if (!builder) return false;
  const spec = builder.tryParseSpecFromOutput(aiOutput);
  if (!spec) return false;
  builder.setSpec(spec);
  return true;
}

/**
 * Try to save implementation plan from AI output during implementation phase.
 * Returns true if a plan was saved.
 */
export function trySaveImplementationPlan(aiOutput: string): boolean {
  const builder = sddState.getBuilder();
  if (!builder) return false;
  const session = builder.getSession();
  if (session.phase !== 'implementation') return false;

  const current = session.implementation ?? '';

  const jsonMatch = aiOutput.match(/```json\s*\[/);
  if (jsonMatch?.index && jsonMatch.index > 0) {
    const plan = aiOutput.substring(0, jsonMatch.index).trim();
    if (plan.length > 50 && plan !== current && !isExplanatoryText(plan)) {
      builder.setImplementation(plan);
      return true;
    }
  }

  if (
    aiOutput.length > 100 &&
    !aiOutput.includes('```json') &&
    aiOutput !== current &&
    !isExplanatoryText(aiOutput)
  ) {
    builder.setImplementation(aiOutput.trim());
    return true;
  }

  return false;
}

/**
 * Auto-detect task completion patterns in AI output and mark tasks.
 * Returns the number of tasks marked as completed.
 */
export function autoDetectTaskCompletion(aiOutput: string): number {
  const tracker = sddState.getTaskTracker();
  if (!tracker) return 0;
  const pending = tracker.getAllNodes({ status: ['pending', 'in_progress'] });
  if (pending.length === 0) return 0;

  let completed = 0;
  const lines = aiOutput.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    const sddDoneMatch = trimmed.match(/\/sdd\s+done\s+(.+)/i);
    if (sddDoneMatch?.[1]) {
      const target = sddDoneMatch[1].trim();
      const num = Number(target);
      if (!Number.isNaN(num) && num >= 1 && num <= pending.length) {
        const node = pending[num - 1];
        if (node && node.status !== 'completed') {
          tracker.updateNodeStatus(node.id, 'completed');
          completed++;
        }
      } else {
        const match = pending.find(
          (n) =>
            n.title.toLowerCase().includes(target.toLowerCase()) ||
            target.toLowerCase().includes(n.title.toLowerCase()),
        );
        if (match && match.status !== 'completed') {
          tracker.updateNodeStatus(match.id, 'completed');
          completed++;
        }
      }
      continue;
    }

    const checkmarkMatch = trimmed.match(/^✅\s*(?:Task:\s*)?(.+)/i);
    if (checkmarkMatch?.[1]) {
      const title = checkmarkMatch[1].trim();
      const match = pending.find(
        (n) =>
          n.title.toLowerCase().includes(title.toLowerCase()) ||
          title.toLowerCase().includes(n.title.toLowerCase()),
      );
      if (match && match.status !== 'completed') {
        tracker.updateNodeStatus(match.id, 'completed');
        completed++;
      }
      continue;
    }

    const taskNumMatch = trimmed.match(/Task\s+(\d+)\s*[:]\s*(?:complete|done|finished)/i);
    if (taskNumMatch?.[1]) {
      const num = Number(taskNumMatch[1]);
      if (num >= 1 && num <= pending.length) {
        const node = pending[num - 1];
        if (node && node.status !== 'completed') {
          tracker.updateNodeStatus(node.id, 'completed');
          completed++;
        }
      }
      continue;
    }

    const completedMatch = trimmed.match(/^(?:Completed|Done|Finished)\s*[:]\s*(.+)/i);
    if (completedMatch?.[1]) {
      const title = completedMatch[1].trim();
      const match = pending.find(
        (n) =>
          n.title.toLowerCase().includes(title.toLowerCase()) ||
          title.toLowerCase().includes(n.title.toLowerCase()),
      );
      if (match && match.status !== 'completed') {
        tracker.updateNodeStatus(match.id, 'completed');
        completed++;
      }
    }
  }

  return completed;
}
