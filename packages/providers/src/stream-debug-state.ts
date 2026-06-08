/**
 * Singleton gate for stream debug logging.
 *
 * WireAdapter reads this on every stream() call, so runtime toggles
 * (via /settings debug-stream on|off) take effect on the next request
 * without recreating provider instances.
 *
 * When enabled, WireAdapter logs a compact per-chunk status line to
 * stderr without printing chunk bodies.
 *
 * The CLI boot path seeds this from config.debugStream at startup.
 */
let _debugStreamEnabled = false;

/** Check whether raw SSE stream debugging is currently active. */
export function isDebugStreamEnabled(): boolean {
  return _debugStreamEnabled;
}

/** Flip the stream debug flag at runtime. Persisted separately via ConfigStore. */
export function setDebugStreamEnabled(enabled: boolean): void {
  _debugStreamEnabled = enabled;
}
