/**
 * Print the "Update available: vX → vY" notice on stderr.
 *
 * If `initialUpdateInfo` is missing (boot's background check missed the
 * cache), this function fires a fresh quick check with a 2s timeout and
 * returns whichever `UpdateInfo` it ended up with. The caller can chain
 * off the return value to short-circuit later in the boot pipeline.
 *
 * Best-effort: any failure to fetch the update info is swallowed (the
 * notice is decorative, not load-bearing). Returns the resolved
 * `UpdateInfo` so callers that want to log it elsewhere don't have to
 * re-run the check.
 */
import { writeErr } from '@wrongstack/core';
import type { UpdateInfo } from './update-check.js';

const NOTICE_FMT = `\n  \x1b[33m↑ Update available: v%s → v%s\x1b[0m  Run \`wrongstack update\` to upgrade.\n\n`;

export async function printUpdateNotice(
  initialUpdateInfo?: UpdateInfo | undefined,
): Promise<UpdateInfo | undefined> {
  let info = initialUpdateInfo;
  if (!info?.outdated) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    try {
      const { checkForUpdate } = await import('./update-check.js');
      info = await checkForUpdate(ac.signal);
    } catch {
      // best-effort
    } finally {
      clearTimeout(timer);
    }
  }
  if (info?.outdated) {
    writeErr(NOTICE_FMT.replace('%s', info.current).replace('%s', info.latest));
  }
  return info;
}
