import { describe, expect, it } from 'vitest';
import {
  analyzeFileActivity,
  normalizeTrackedPath,
  pathsReferToSameFile,
} from '../../src/components/FileActivityDrawer.js';

describe('FileActivityDrawer model', () => {
  it('matches relative and absolute Windows paths for the same file', () => {
    expect(normalizeTrackedPath('.\\src\\Editor.tsx')).toBe('src/editor.tsx');
    expect(
      pathsReferToSameFile(
        'D:\\Codebox\\WrongStack\\packages\\webui\\src\\Editor.tsx',
        'packages/webui/src/Editor.tsx',
      ),
    ).toBe(true);
    expect(pathsReferToSameFile('src/a.ts', 'src/b.ts')).toBe(false);
  });

  it('flags repeated multi-actor mutations as high churn', () => {
    const now = Date.now();
    const records = Array.from({ length: 8 }, (_, index) => ({
      at: now - index * 10_000,
      action: index % 2 === 0 ? 'edit' : 'write',
      actor: index % 3 === 0 ? 'leader' : index % 3 === 1 ? 'worker-a' : 'worker-b',
      sessionId: `session-${index % 2}`,
      taskId: `task-${index % 2}`,
    }));

    expect(analyzeFileActivity(records, now)).toEqual({
      level: 'churn',
      mutationCount: 8,
      sessionCount: 2,
      actorCount: 3,
      taskCount: 2,
    });
  });

  it('ignores stale activity when deriving the current state', () => {
    const now = Date.now();
    expect(
      analyzeFileActivity(
        [
          {
            at: now - 31 * 60_000,
            action: 'write',
            actor: 'worker',
            sessionId: 'session-old',
            taskId: 'task-old',
          },
        ],
        now,
      ),
    ).toEqual({ level: 'quiet', mutationCount: 0, sessionCount: 0, actorCount: 0, taskCount: 0 });
  });
});
