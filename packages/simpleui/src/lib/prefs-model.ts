/** Settings model — the small slice of server prefs SimpleUI exposes.
 *
 * The server is the source of truth: `prefs.get` seeds us, `prefs.update`
 * writes through to `agent.ctx.meta` + config.json, and the server answers
 * with a `prefs.updated` broadcast that every tab re-reads. We deliberately
 * project only the handful of keys SimpleUI surfaces — the snapshot carries
 * the full `PREF_KEYS` set and unknown keys must survive untouched.
 */

export type AutonomyMode = 'off' | 'suggest' | 'auto';

export interface SimplePrefs {
  autonomy: AutonomyMode;
  yolo: boolean;
  enhanceEnabled: boolean;
  enhanceLanguage: string;
  chime: boolean;
  confirmExit: boolean;
}

export const DEFAULT_PREFS: SimplePrefs = {
  autonomy: 'off',
  yolo: false,
  enhanceEnabled: false,
  enhanceLanguage: 'english',
  chime: false,
  confirmExit: false,
};

export const AUTONOMY_MODES: readonly AutonomyMode[] = ['off', 'suggest', 'auto'];

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Project a `prefs.updated` snapshot onto the keys SimpleUI renders.
 *  Anything absent or malformed keeps the previous value so a partial
 *  snapshot can never blank the panel. */
export function parsePrefs(payload: unknown, previous: SimplePrefs = DEFAULT_PREFS): SimplePrefs {
  if (!payload || typeof payload !== 'object') return previous;
  const raw = payload as Record<string, unknown>;
  const autonomy = raw['autonomy'];
  return {
    autonomy: AUTONOMY_MODES.includes(autonomy as AutonomyMode)
      ? (autonomy as AutonomyMode)
      : // `eternal` and friends are live-only modes the server may report;
        // they have no SimpleUI control, so hold the previous value rather
        // than misrepresenting the running mode as `off`.
        previous.autonomy,
    yolo: bool(raw['yolo'], previous.yolo),
    enhanceEnabled: bool(raw['enhanceEnabled'], previous.enhanceEnabled),
    enhanceLanguage:
      typeof raw['enhanceLanguage'] === 'string' && raw['enhanceLanguage']
        ? raw['enhanceLanguage']
        : previous.enhanceLanguage,
    chime: bool(raw['chime'], previous.chime),
    confirmExit: bool(raw['confirmExit'], previous.confirmExit),
  };
}
