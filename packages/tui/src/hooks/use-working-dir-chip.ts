import type { Context } from '@wrongstack/core';
import * as path from 'node:path';
import { useEffect, useState } from 'react';

export function formatWorkingDirChip(
  workingDir: string | undefined,
  projectRoot: string,
): string | undefined {
  if (!workingDir || workingDir === projectRoot) return undefined;
  // Pick the path flavor from the DATA, not the host platform — the chip may
  // be asked to render Windows-style paths (drive letter, backslashes) on a
  // POSIX host.
  const impl = workingDir.includes('\\') || projectRoot.includes('\\') ? path.win32 : path;
  const rel = impl.relative(projectRoot, workingDir) || '.';
  if (rel === '.') return undefined;
  return rel.replaceAll(impl.sep, '/');
}

/**
 * Derive and keep in sync the relative working-directory chip text shown in
 * the TUI status bar.
 */
export function useWorkingDirChip(ctx: Context, projectRoot: string): string | undefined {
  const [workingDirChip, setWorkingDirChip] = useState<string | undefined>(() =>
    formatWorkingDirChip(ctx.workingDir, projectRoot),
  );

  useEffect(() => {
    setWorkingDirChip(formatWorkingDirChip(ctx.workingDir, projectRoot));
    return ctx.onWorkingDirChanged((newDir) => {
      setWorkingDirChip(formatWorkingDirChip(newDir, projectRoot));
    });
  }, [ctx, projectRoot]);

  return workingDirChip;
}
