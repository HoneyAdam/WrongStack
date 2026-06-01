// TEMPORARY CI diagnostic reporter — pinpoints which test module hangs on
// POSIX runners. Logs each module's path to stderr (unbuffered) on start and
// end. After a hang, the last `[probe] START` line with no matching
// `[probe] END` is the culprit. Remove once the leak is found and fixed.
function pathOf(mod) {
  return mod?.moduleId ?? mod?.id ?? mod?.filepath ?? mod?.name ?? String(mod);
}
export default class HangProbeReporter {
  // Vitest 4 module-level hooks
  onTestModuleStart(mod) {
    process.stderr.write(`[probe] START ${pathOf(mod)}\n`);
  }
  onTestModuleEnd(mod) {
    process.stderr.write(`[probe] END   ${pathOf(mod)}\n`);
  }
  // Older task-based fallbacks (defensive across API versions)
  onPathsCollected(paths) {
    process.stderr.write(`[probe] COLLECTED ${(paths ?? []).length} files\n`);
  }
}
