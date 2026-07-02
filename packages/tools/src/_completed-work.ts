import type { Context } from '@wrongstack/core';
import { saveCompletedWorkCheckpoint } from '@wrongstack/core';

export async function persistCompletedWork(ctx: Context): Promise<void> {
  const filePath = (ctx.meta as Record<string, unknown>)['completedWork.path'];
  if (typeof filePath !== 'string' || !filePath) return;
  await saveCompletedWorkCheckpoint(
    filePath,
    ctx.session?.id ?? 'unknown',
    ctx.contextEvidence?.completedWork ?? [],
  );
}
