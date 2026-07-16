/**
 * Preference key list, snapshot, persistence, and config-seeding.
 *
 * ## What lives here
 *
 * - `PREF_KEYS`           – the canonical list of browser-setting ↔ config-file keys.
 * - `createPrefsSeeding`  – factory that returns `{ prefSnapshot, persistPrefs }`
 *                           with file I/O captured in closure.
 * - `seedConfigToMeta`    – one-time call at startup: reads config.json and seeds
 *                           `agent.ctx.meta` so the settings panel shows the real
 *                           persisted values instead of localStorage defaults.
 *
 * ## Extraction history
 *
 * PR 9 of Issue #30 – extracted from webui-server.ts (was inline between the
 * `PREF_KEYS` array and the `PrefsContext` construction).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from '@wrongstack/core';

// Minimal shape of what seedConfigToMeta / createPrefsSeeding need from runWebUI's opts.
// CliWebUIOptions is defined in webui-server.ts; importing it directly would create a
// cycle since webui-server.ts imports from this module.
interface CliWebUIOptions {
  agent: { ctx: { meta: Record<string, unknown> } };
  globalConfigPath?: string | undefined;
  appConfig?: {
    fallbackModels?: string[] | undefined;
    fallbackProfiles?: Record<string, string[]> | undefined;
    favoriteModels?: string[] | undefined;
    favoriteModelsOnly?: boolean | undefined;
    fallbackAuto?: boolean | undefined;
    modelMatrix?: Config['modelMatrix'] | undefined;
    uiLocale?: string | undefined;
  } | undefined;
}

import {
  atomicWrite,
  DefaultSecretVault,
  FallbackProfileManager,
  decryptConfigSecrets,
  encryptConfigSecrets,
} from '@wrongstack/core';

// ── PREF_KEYS ─────────────────────────────────────────────────────────────────

/** Keys synced between `agent.ctx.meta` and `config.json`. */
export const PREF_KEYS = [
  'autonomy',
  'autonomyDelayMs',
  'autoProceedMaxIterations',
  'yolo',
  'maxIterations',
  'chime',
  'confirmExit',
  'streamFleet',
  'nextPrediction',
  'fallbackModels',
  'fallbackProfiles',
  'favoriteModels',
  'favoriteModelsOnly',
  'modelMatrix',
  'fallbackAuto',
  'uiLocale',
  'enhanceEnabled',
  'enhanceDelayMs',
  'enhanceLanguage',
  'featureMcp',
  'featurePlugins',
  'featureMemory',
  'featureSkills',
  'featureModelsRegistry',
  'indexOnStart',
  'contextAutoCompact',
  'contextStrategy',
  'contextMode',
  'tokenSavingTier',
  'maxConcurrent',
  'titleAnimation',
  // Model-runtime reasoning/cache — parity with the standalone server, which
  // already persists these. Without them, `wrongstack --webui` silently drops
  // reasoning/cache changes made in the browser (lost on restart).
  'reasoningMode',
  'reasoningEffort',
  'reasoningPreserve',
  'cacheTtl',
  'logLevel',
  'auditLevel',
  'hqEnabled',
  'hqUrl',
  'hqToken',
  'hqRawContent',
  'refinerProvider',
  'refinerModel',
  'refinerFallbackProfile',
  'thinkingWord',
  'statuslineMode',
  'animationStyle',
  // Telegram plugin notification settings (parity with the standalone server).
  'tgConfigured',
  'tgSessionEnd',
  'tgDelegate',
  'tgLongToolMs',
  // Safety / system prefs (parity with /settings breaker, fs-access, debug-stream).
  'breakerEnabled',
  'breakerAutoKillResetMs',
  'fsAccess',
  'debugStream',
  'chimeraAutoFix',
  // Chimera (post-session) + auto-review (mid-session) settings.
  // Persisted to config.extensions['wstack-chimera'] / ['wstack-auto-review']
  // so the running plugins pick up changes after a session restart.
  'chimeraEnabled',
  'chimeraProvider',
  'chimeraModel',
  'chimeraMaxFiles',
  'autoReviewEnabled',
  'autoReviewProvider',
  'autoReviewModel',
  'autoReviewFallbackProfile',
  'autoReviewFallbackModels',
  'autoReviewDebounceMs',
  'autoReviewMaxFilesPerBatch',
  'autoReviewMaxConcurrentReviews',
  'autoReviewCascadeOn',
  'pluginsEnabled',
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

type PrefSnapshot = Record<string, unknown>;

// ── seedConfigToMeta ──────────────────────────────────────────────────────────

/**
 * One-time startup seed: reads `globalConfigPath` and copies recognised fields
 * into `agent.ctx.meta` so the browser settings panel starts with the real
 * persisted values instead of blank/undefined.
 *
 * Best-effort – missing or corrupt config leaves prefs unseeded.
 */
export async function seedConfigToMeta(opts: CliWebUIOptions): Promise<void> {
  const configPath = opts.globalConfigPath;
  if (!configPath) return;

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const autonomyCfg = (cfg.autonomy as Record<string, unknown>) ?? {};
    const features = (cfg.features as Record<string, unknown>) ?? {};
    const meta = opts.agent.ctx.meta;

    const rawMode = autonomyCfg['defaultMode'];
    meta['autonomy'] = rawMode === 'suggest' || rawMode === 'auto' ? rawMode : 'off';
    meta['autonomyDelayMs'] = (autonomyCfg['autoProceedDelayMs'] as number) ?? 45_000;
    meta['autoProceedMaxIterations'] = (autonomyCfg['autoProceedMaxIterations'] as number) ?? 50;
    meta['yolo'] = (autonomyCfg['yolo'] as boolean) ?? (cfg.yolo as boolean) ?? false;
    meta['chime'] = (autonomyCfg['chime'] as boolean) ?? false;
    meta['confirmExit'] = autonomyCfg['confirmExit'] !== false;
    meta['streamFleet'] = autonomyCfg['streamFleet'] !== false;
    meta['enhanceEnabled'] = (autonomyCfg['enhance'] as boolean) ?? true;
    meta['enhanceDelayMs'] = (autonomyCfg['enhanceDelayMs'] as number) ?? 60_000;
    meta['enhanceLanguage'] = (autonomyCfg['enhanceLanguage'] as string) ?? 'original';
    meta['nextPrediction'] = (cfg.nextPrediction as boolean) ?? false;
    meta['fallbackModels'] = (cfg.fallbackModels as string[]) ?? [];
    meta['fallbackProfiles'] =
      (cfg.fallbackProfiles as Record<string, string[]> | undefined) ?? {};
    meta['favoriteModels'] = (cfg.favoriteModels as string[]) ?? [];
    meta['favoriteModelsOnly'] = cfg.favoriteModelsOnly === true;
    meta['modelMatrix'] = (cfg.modelMatrix as Config['modelMatrix'] | undefined) ?? {};
    meta['fallbackAuto'] = cfg.fallbackAuto !== false;
    if (typeof cfg.uiLocale === 'string' && cfg.uiLocale) meta['uiLocale'] = cfg.uiLocale;
    meta['featureMcp'] = features['mcp'] !== false;
    meta['featurePlugins'] = features['plugins'] !== false;
    meta['featureMemory'] = features['memory'] !== false;
    meta['featureSkills'] = features['skills'] !== false;
    meta['featureModelsRegistry'] = features['modelsRegistry'] !== false;
    meta['indexOnStart'] = (cfg.indexing as Record<string, unknown>)?.['onSessionStart'] !== false;
    meta['contextAutoCompact'] =
      (cfg.context as Record<string, unknown>)?.['autoCompact'] !== false;
    meta['contextStrategy'] = (cfg.context as Record<string, unknown>)?.['strategy'] ?? 'hybrid';
    meta['contextMode'] = (cfg.context as Record<string, unknown>)?.['mode'] ?? 'balanced';
    {
      const tsm = (features as Record<string, unknown>)['tokenSavingMode'];
      meta['tokenSavingTier'] = typeof tsm === 'string' ? tsm : tsm ? 'medium' : 'off';
    }
    meta['maxConcurrent'] = typeof cfg.maxConcurrent === 'number' ? cfg.maxConcurrent : 10;
    meta['titleAnimation'] = autonomyCfg['terminalTitleAnimation'] !== false;
    {
      const mr = (cfg.modelRuntime as Record<string, unknown> | undefined) ?? {};
      const reasoning = (mr['reasoning'] as Record<string, unknown> | undefined) ?? {};
      const cache = (mr['cache'] as Record<string, unknown> | undefined) ?? {};
      meta['reasoningMode'] = (reasoning['mode'] as string) ?? 'auto';
      meta['reasoningEffort'] = (reasoning['effort'] as string) ?? 'high';
      meta['reasoningPreserve'] = reasoning['preserve'] === true;
      meta['cacheTtl'] = (cache['ttl'] as string) ?? 'default';
    }
    meta['logLevel'] = (cfg.log as Record<string, unknown>)?.['level'] ?? 'info';
    meta['auditLevel'] = (cfg.session as Record<string, unknown>)?.['auditLevel'] ?? 'standard';
    meta['maxIterations'] = (cfg.tools as Record<string, unknown>)?.['maxIterations'] ?? 500;
    const hqCfg = (cfg.hq as Record<string, unknown>) ?? {};
    meta['hqEnabled'] = hqCfg['enabled'] === true;
    meta['hqUrl'] = typeof hqCfg['url'] === 'string' ? (hqCfg['url'] as string) : '';
    meta['hqToken'] = typeof hqCfg['token'] === 'string' ? (hqCfg['token'] as string) : '';
    meta['hqRawContent'] = hqCfg['rawContent'] === true;
    meta['refinerProvider'] = (autonomyCfg['refinerProvider'] as string) ?? '';
    meta['refinerModel'] = (autonomyCfg['refinerModel'] as string) ?? '';
    meta['refinerFallbackProfile'] = (autonomyCfg['refinerFallbackProfile'] as string) ?? '';
    meta['thinkingWord'] = (autonomyCfg['thinkingWord'] as string) ?? 'thinking';
    meta['statuslineMode'] = (autonomyCfg['statuslineMode'] as string) ?? 'detailed';
    meta['animationStyle'] = (autonomyCfg['animationStyle'] as string) ?? 'rainbow';
    // Telegram plugin notification settings live under extensions.telegram —
    // same path the standalone server seeds and /telegram-settings writes.
    const tgExt = (cfg.extensions as Record<string, Record<string, unknown>> | undefined)?.[
      'telegram'
    ];
    meta['tgConfigured'] =
      typeof tgExt?.['botToken'] === 'string' && (tgExt['botToken'] as string).length > 0;
    meta['tgSessionEnd'] = tgExt?.['notifyOnSessionEnd'] === true;
    meta['tgDelegate'] = tgExt?.['notifyOnDelegate'] !== false; // default true
    const tgMs = tgExt?.['longToolThresholdMs'];
    meta['tgLongToolMs'] = typeof tgMs === 'number' ? (tgMs as number) : 30_000;
    // Safety / system prefs
    const cbCfg = (cfg.circuitBreaker as Record<string, unknown>) ?? {};
    meta['breakerEnabled'] = cbCfg['enabled'] === true;
    meta['breakerAutoKillResetMs'] =
      typeof cbCfg['autoKillResetMs'] === 'number' ? cbCfg['autoKillResetMs'] : 60_000;
    {
      // Same precedence as deriveFsAccessPair: features.allowOutsideProjectRoot
      // wins when set, else the legacy tools.restrictToProjectRoot inverse.
      const featuresAllow = features['allowOutsideProjectRoot'];
      const toolsRestrict = (cfg.tools as Record<string, unknown>)?.['restrictToProjectRoot'];
      const allow =
        featuresAllow !== undefined
          ? featuresAllow === true
          : toolsRestrict !== undefined
            ? toolsRestrict !== true
            : true;
      meta['fsAccess'] = allow ? 'unrestricted' : 'project';
    }
    meta['debugStream'] = cfg.debugStream === true;

    // Chimera (post-session) — seed from extensions['wstack-chimera'].
    // Defaults match ResolvedChimeraConfig (chimera-plugin.ts:34):
    // enabled=true; provider/model/session fallback.
    const chimeraExt = (cfg.extensions as Record<string, Record<string, unknown>> | undefined)?.[
      'wstack-chimera'
    ];
    meta['chimeraEnabled'] = chimeraExt?.['enabled'] !== false; // default true
    meta['chimeraProvider'] = (chimeraExt?.['provider'] as string) ?? '';
    meta['chimeraModel'] = (chimeraExt?.['model'] as string) ?? '';
    meta['chimeraMaxFiles'] =
      typeof chimeraExt?.['maxFiles'] === 'number' && (chimeraExt['maxFiles'] as number) >= 1
        ? (chimeraExt['maxFiles'] as number)
        : 15;
    const autoFix = chimeraExt?.['autoFix'];
    meta['chimeraAutoFix'] =
      autoFix === 'off' || autoFix === 'ask' || autoFix === 'auto' ? autoFix : 'off';

    // Auto-review (mid-session continuous) — seed from extensions['wstack-auto-review'].
    // Defaults match ResolvedAutoReviewConfig (auto-review-plugin.ts:42):
    // enabled=false; provider/model resolve via fallbackProfile/effective chain.
    const autoReviewExt = (cfg.extensions as Record<string, Record<string, unknown>> | undefined)?.[
      'wstack-auto-review'
    ];
    meta['autoReviewEnabled'] = autoReviewExt?.['enabled'] === true; // default false (strict opt-in)
    meta['autoReviewProvider'] = (autoReviewExt?.['provider'] as string) ?? '';
    meta['autoReviewModel'] = (autoReviewExt?.['model'] as string) ?? '';
    meta['autoReviewFallbackProfile'] = (autoReviewExt?.['fallbackProfile'] as string) ?? '';
    // Resolve the effective fallback chain for auto-review via the same
    // FallbackProfileManager the plugin uses (auto-review-plugin.ts:62-69),
    // so the SettingsPanel displays the chain the plugin will actually run.
    // Inputs: extensions['wstack-auto-review'].fallbackProfile (named) OR
    // the session-effective chain via config.fallbackModels/fallbackProfiles.
    {
      let resolvedChain: ReadonlyArray<{ providerId: string; model: string }> = [];
      try {
        // cfg is the parsed config.json (JSON.parse → Record<string, unknown>).
        // FallbackProfileManager takes Config; cast through unknown since the
        // resolver only reads the fallback-models fields it knows about.
        const mgr = new FallbackProfileManager(cfg as unknown as Config);
        const named = autoReviewExt?.['fallbackProfile'];
        resolvedChain =
          typeof named === 'string' && named.length > 0
            ? mgr.resolve(named)
            : mgr.resolveEffective({ fallbackAuto: true });
      } catch {
        resolvedChain = [];
      }
      meta['autoReviewFallbackModels'] = resolvedChain.map(
        (e) => `${e.providerId}/${e.model}`,
      );
    }
    meta['autoReviewDebounceMs'] =
      typeof autoReviewExt?.['debounceMs'] === 'number' && (autoReviewExt['debounceMs'] as number) >= 0
        ? (autoReviewExt['debounceMs'] as number)
        : 5000;
    meta['autoReviewMaxFilesPerBatch'] =
      typeof autoReviewExt?.['maxFilesPerBatch'] === 'number' &&
      (autoReviewExt['maxFilesPerBatch'] as number) >= 1
        ? (autoReviewExt['maxFilesPerBatch'] as number)
        : 15;
    meta['autoReviewMaxConcurrentReviews'] =
      typeof autoReviewExt?.['maxConcurrentReviews'] === 'number' &&
      (autoReviewExt['maxConcurrentReviews'] as number) >= 1
        ? (autoReviewExt['maxConcurrentReviews'] as number)
        : 2;
    const cascade = autoReviewExt?.['cascadeOn'];
    meta['autoReviewCascadeOn'] =
      cascade === 'critical' || cascade === 'high' ? cascade : 'off';
  } catch {
    // best-effort — missing/corrupt config just leaves prefs unseeded
  }
}

// ── createPrefsSeeding ────────────────────────────────────────────────────────

interface PrefsSeeding {
  prefSnapshot: () => PrefSnapshot;
  persistPrefs: (payload: PrefSnapshot) => Promise<void>;
}

/**
 * Factory – returns `prefSnapshot` and `persistPrefs` with file I/O captured
 * in closure. Call once per `runWebUI` instance.
 */
export function createPrefsSeeding(opts: CliWebUIOptions): PrefsSeeding {
  let prefWriteLock: Promise<unknown> = Promise.resolve();

  const patchLiveAppConfig = (patch: NonNullable<CliWebUIOptions['appConfig']>): void => {
    if (!opts.appConfig) return;
    opts.appConfig = { ...opts.appConfig, ...patch };
  };

  /** Capture the current set of live preference values from agent.ctx.meta. */
  const prefSnapshot = (): PrefSnapshot => {
    const snapshot: PrefSnapshot = {};
    for (const k of PREF_KEYS) {
      if (k in opts.agent.ctx.meta) snapshot[k] = opts.agent.ctx.meta[k];
    }
    return snapshot;
  };

  /** Persist a preference diff back to config.json. */
  const persistPrefs = async (payload: PrefSnapshot): Promise<void> => {
    const configPath = opts.globalConfigPath;
    if (Array.isArray(payload['fallbackModels']))
      patchLiveAppConfig({ fallbackModels: payload['fallbackModels'] as string[] });
    if (
      payload['fallbackProfiles'] &&
      typeof payload['fallbackProfiles'] === 'object' &&
      !Array.isArray(payload['fallbackProfiles'])
    ) {
      patchLiveAppConfig({
        fallbackProfiles: payload['fallbackProfiles'] as Record<string, string[]>,
      });
    }
    if (Array.isArray(payload['favoriteModels']))
      patchLiveAppConfig({ favoriteModels: payload['favoriteModels'] as string[] });
    if (typeof payload['favoriteModelsOnly'] === 'boolean')
      patchLiveAppConfig({ favoriteModelsOnly: payload['favoriteModelsOnly'] });
    if (typeof payload['fallbackAuto'] === 'boolean')
      patchLiveAppConfig({ fallbackAuto: payload['fallbackAuto'] });
    if (typeof payload['uiLocale'] === 'string')
      patchLiveAppConfig({ uiLocale: payload['uiLocale'] });
    if (
      payload['modelMatrix'] &&
      typeof payload['modelMatrix'] === 'object' &&
      !Array.isArray(payload['modelMatrix'])
    ) {
      patchLiveAppConfig({ modelMatrix: payload['modelMatrix'] as Config['modelMatrix'] });
    }
    if (!configPath) return;

    const write = async (): Promise<void> => {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const vault = new DefaultSecretVault({
        keyFile: path.join(path.dirname(configPath), '.key'),
      });
      const decrypted = decryptConfigSecrets(parsed, vault) as Record<string, unknown>;

      // Map meta keys back to their config-file paths.
      const autonomy = (decrypted.autonomy as Record<string, unknown>) ?? {};
      // defaultMode only supports off|suggest|auto in the Config schema —
      // eternal/eternal-parallel are live-only modes (autonomy is user-owned;
      // sessions never START in eternal). Same guard as the standalone server.
      if (
        typeof payload['autonomy'] === 'string' &&
        ['off', 'suggest', 'auto'].includes(payload['autonomy'])
      ) {
        autonomy['defaultMode'] = payload['autonomy'];
      }
      if ('autonomyDelayMs' in payload) autonomy['autoProceedDelayMs'] = payload['autonomyDelayMs'];
      if ('autoProceedMaxIterations' in payload)
        autonomy['autoProceedMaxIterations'] = payload['autoProceedMaxIterations'];
      if ('yolo' in payload) {
        autonomy['yolo'] = payload['yolo'];
        decrypted['yolo'] = payload['yolo'];
      }
      if ('chime' in payload) autonomy['chime'] = payload['chime'];
      if ('confirmExit' in payload) autonomy['confirmExit'] = payload['confirmExit'];
      if ('streamFleet' in payload) {
        autonomy['streamFleet'] = payload['streamFleet'];
        // Keep the TUI's fleetChatVerbosity enum in step: it wins over the
        // boolean at resolve time, so a webui toggle would otherwise be
        // silently overridden by a previously persisted enum value.
        autonomy['fleetChatVerbosity'] = payload['streamFleet'] ? 'full' : 'off';
      }
      if ('enhanceEnabled' in payload) autonomy['enhance'] = payload['enhanceEnabled'];
      if ('enhanceDelayMs' in payload) autonomy['enhanceDelayMs'] = payload['enhanceDelayMs'];
      if ('enhanceLanguage' in payload) autonomy['enhanceLanguage'] = payload['enhanceLanguage'];
      if ('nextPrediction' in payload) decrypted['nextPrediction'] = payload['nextPrediction'];
      // Active provider/model — written by model.switch so a browser model
      // change survives restart (parity with the standalone server, which
      // persists provider+model in its model.switch handler).
      if (typeof payload['provider'] === 'string') decrypted['provider'] = payload['provider'];
      if (typeof payload['model'] === 'string') decrypted['model'] = payload['model'];
      if ('fallbackModels' in payload) decrypted['fallbackModels'] = payload['fallbackModels'];
      if ('fallbackProfiles' in payload)
        decrypted['fallbackProfiles'] = payload['fallbackProfiles'];
      if ('favoriteModels' in payload) decrypted['favoriteModels'] = payload['favoriteModels'];
      if ('favoriteModelsOnly' in payload)
        decrypted['favoriteModelsOnly'] = payload['favoriteModelsOnly'];
      if ('modelMatrix' in payload) decrypted['modelMatrix'] = payload['modelMatrix'];
      if ('fallbackAuto' in payload) decrypted['fallbackAuto'] = payload['fallbackAuto'];
      if (typeof payload['uiLocale'] === 'string') decrypted['uiLocale'] = payload['uiLocale'];
      decrypted['autonomy'] = autonomy;

      if (
        'featureMcp' in payload ||
        'featurePlugins' in payload ||
        'featureMemory' in payload ||
        'featureSkills' in payload ||
        'featureModelsRegistry' in payload
      ) {
        const features = (decrypted.features as Record<string, unknown>) ?? {};
        if ('featureMcp' in payload) features['mcp'] = payload['featureMcp'];
        if ('featurePlugins' in payload) features['plugins'] = payload['featurePlugins'];
        if ('featureMemory' in payload) features['memory'] = payload['featureMemory'];
        if ('featureSkills' in payload) features['skills'] = payload['featureSkills'];
        if ('featureModelsRegistry' in payload)
          features['modelsRegistry'] = payload['featureModelsRegistry'];
        decrypted['features'] = features;
      }

      if ('indexOnStart' in payload) {
        const idx = (decrypted.indexing as Record<string, unknown>) ?? {};
        idx['onSessionStart'] = payload['indexOnStart'];
        decrypted['indexing'] = idx;
      }

      if ('contextAutoCompact' in payload || 'contextStrategy' in payload || 'contextMode' in payload) {
        const ctx2 = (decrypted.context as Record<string, unknown>) ?? {};
        if ('contextAutoCompact' in payload) ctx2['autoCompact'] = payload['contextAutoCompact'];
        if ('contextStrategy' in payload) ctx2['strategy'] = payload['contextStrategy'];
        if ('contextMode' in payload) ctx2['mode'] = payload['contextMode'];
        decrypted['context'] = ctx2;
      }

      if ('tokenSavingTier' in payload) {
        const feats = (decrypted.features as Record<string, unknown>) ?? {};
        feats['tokenSavingMode'] = payload['tokenSavingTier'];
        decrypted['features'] = feats;
      }

      if ('maxConcurrent' in payload) decrypted['maxConcurrent'] = payload['maxConcurrent'];

      if ('titleAnimation' in payload) {
        autonomy['terminalTitleAnimation'] = payload['titleAnimation'];
        decrypted['autonomy'] = autonomy;
      }

      // Refiner + TUI visual prefs → autonomy block
      if ('refinerProvider' in payload) autonomy['refinerProvider'] = payload['refinerProvider'];
      if ('refinerModel' in payload) autonomy['refinerModel'] = payload['refinerModel'];
      if ('refinerFallbackProfile' in payload) autonomy['refinerFallbackProfile'] = payload['refinerFallbackProfile'];
      if ('thinkingWord' in payload) autonomy['thinkingWord'] = payload['thinkingWord'];
      if ('statuslineMode' in payload) autonomy['statuslineMode'] = payload['statuslineMode'];
      if ('animationStyle' in payload) autonomy['animationStyle'] = payload['animationStyle'];
      if ('refinerProvider' in payload || 'refinerModel' in payload || 'refinerFallbackProfile' in payload || 'thinkingWord' in payload || 'statuslineMode' in payload || 'animationStyle' in payload) {
        decrypted['autonomy'] = autonomy;
      }

      if (
        'reasoningMode' in payload ||
        'reasoningEffort' in payload ||
        'reasoningPreserve' in payload ||
        'cacheTtl' in payload
      ) {
        const mr = (decrypted.modelRuntime as Record<string, unknown>) ?? {};
        const reasoning = (mr['reasoning'] as Record<string, unknown>) ?? {};
        if ('reasoningMode' in payload) reasoning['mode'] = payload['reasoningMode'];
        if ('reasoningEffort' in payload) reasoning['effort'] = payload['reasoningEffort'];
        if ('reasoningPreserve' in payload) reasoning['preserve'] = payload['reasoningPreserve'];
        mr['reasoning'] = reasoning;
        if ('cacheTtl' in payload) {
          if (payload['cacheTtl'] === 'default') delete mr['cache'];
          else mr['cache'] = { ttl: payload['cacheTtl'] };
        }
        decrypted['modelRuntime'] = mr;
      }

      if ('logLevel' in payload) {
        const log = (decrypted.log as Record<string, unknown>) ?? {};
        log['level'] = payload['logLevel'];
        decrypted['log'] = log;
      }

      if ('auditLevel' in payload) {
        const session = (decrypted.session as Record<string, unknown>) ?? {};
        session['auditLevel'] = payload['auditLevel'];
        decrypted['session'] = session;
      }

      if ('maxIterations' in payload) {
        const tools = (decrypted.tools as Record<string, unknown>) ?? {};
        tools['maxIterations'] = payload['maxIterations'];
        decrypted['tools'] = tools;
      }

      // HQ settings → top-level `hq` key.
      if (
        'hqEnabled' in payload ||
        'hqUrl' in payload ||
        'hqToken' in payload ||
        'hqRawContent' in payload
      ) {
        const hqCfg = (decrypted.hq as Record<string, unknown>) ?? {};
        if (typeof payload['hqEnabled'] === 'boolean') hqCfg['enabled'] = payload['hqEnabled'];
        if (typeof payload['hqUrl'] === 'string') hqCfg['url'] = payload['hqUrl'];
        if (typeof payload['hqToken'] === 'string') hqCfg['token'] = payload['hqToken'];
        if (typeof payload['hqRawContent'] === 'boolean')
          hqCfg['rawContent'] = payload['hqRawContent'];
        decrypted.hq = hqCfg;
      }

      // Process circuit breaker → Config.circuitBreaker
      if (
        typeof payload['breakerEnabled'] === 'boolean' ||
        typeof payload['breakerAutoKillResetMs'] === 'number'
      ) {
        const cb = (decrypted.circuitBreaker as Record<string, unknown>) ?? {};
        if (typeof payload['breakerEnabled'] === 'boolean') cb['enabled'] = payload['breakerEnabled'];
        if (typeof payload['breakerAutoKillResetMs'] === 'number')
          cb['autoKillResetMs'] = payload['breakerAutoKillResetMs'];
        decrypted['circuitBreaker'] = cb;
      }

      // Filesystem access scope — dual-write the inverse pair (same rule as
      // deriveFsAccessPair: tools.restrictToProjectRoot legacy,
      // features.allowOutsideProjectRoot canonical).
      if (payload['fsAccess'] === 'unrestricted' || payload['fsAccess'] === 'project') {
        const restrict = payload['fsAccess'] === 'project';
        const toolsCfg = (decrypted.tools as Record<string, unknown>) ?? {};
        toolsCfg['restrictToProjectRoot'] = restrict;
        decrypted['tools'] = toolsCfg;
        const featsCfg = (decrypted.features as Record<string, unknown>) ?? {};
        featsCfg['allowOutsideProjectRoot'] = !restrict;
        decrypted['features'] = featsCfg;
      }

      // Raw SSE debug dump → top-level Config.debugStream
      if (typeof payload['debugStream'] === 'boolean')
        decrypted['debugStream'] = payload['debugStream'];

      // Telegram plugin notification settings → extensions.telegram (parity
      // with the standalone server / the path /telegram-settings writes).
      const tgTouched =
        typeof payload['tgSessionEnd'] === 'boolean' ||
        typeof payload['tgDelegate'] === 'boolean' ||
        typeof payload['tgLongToolMs'] === 'number';
      if (tgTouched) {
        const ext = (decrypted.extensions as Record<string, Record<string, unknown>>) ?? {};
        const tg = ext['telegram'] ?? {};
        if (typeof payload['tgSessionEnd'] === 'boolean')
          tg['notifyOnSessionEnd'] = payload['tgSessionEnd'];
        if (typeof payload['tgDelegate'] === 'boolean')
          tg['notifyOnDelegate'] = payload['tgDelegate'];
        if (typeof payload['tgLongToolMs'] === 'number')
          tg['longToolThresholdMs'] = payload['tgLongToolMs'];
        ext['telegram'] = tg;
        decrypted.extensions = ext;
      }

      // Per-plugin enable/disable → extensions.<name>.enabled
      if (typeof payload['pluginsEnabled'] === 'object' && payload['pluginsEnabled'] !== null) {
        const ext = (decrypted.extensions as Record<string, Record<string, unknown>>) ?? {};
        for (const [pluginName, enabled] of Object.entries(payload['pluginsEnabled'] as Record<string, boolean>)) {
          const pExt = ext[pluginName] ?? {};
          pExt['enabled'] = enabled;
          ext[pluginName] = pExt;
        }
        decrypted.extensions = ext;
      }
      // chimeraAutoFix → extensions.wstack-chimera.autoFix
      if (typeof payload['chimeraAutoFix'] === 'string') {
        const ext = (decrypted.extensions as Record<string, Record<string, unknown>>) ?? {};
        const chimera = ext['wstack-chimera'] ?? {};
        // Narrow the write to the documented enum values, mirroring the
        // autonomy.defaultMode guard at L369-372 — without this, a junk
        // WS payload would persist any string and the seeder at L259-260
        // would silently coerce it back to 'off' on the next load.
        if (
          payload['chimeraAutoFix'] === 'off' ||
          payload['chimeraAutoFix'] === 'ask' ||
          payload['chimeraAutoFix'] === 'auto'
        ) {
          chimera['autoFix'] = payload['chimeraAutoFix'];
        }
        ext['wstack-chimera'] = chimera;
        decrypted.extensions = ext;
      }

      // Chimera (post-session) → extensions['wstack-chimera'] (mirrors
      // ResolvedChimeraConfig from chimera-plugin.ts:34).
      const chimeraTouched =
        typeof payload['chimeraEnabled'] === 'boolean' ||
        typeof payload['chimeraProvider'] === 'string' ||
        typeof payload['chimeraModel'] === 'string' ||
        typeof payload['chimeraMaxFiles'] === 'number';
      if (chimeraTouched) {
        const ext = (decrypted.extensions as Record<string, Record<string, unknown>>) ?? {};
        const chimera = ext['wstack-chimera'] ?? {};
        if (typeof payload['chimeraEnabled'] === 'boolean')
          chimera['enabled'] = payload['chimeraEnabled'];
        if (typeof payload['chimeraProvider'] === 'string')
          chimera['provider'] = payload['chimeraProvider'];
        if (typeof payload['chimeraModel'] === 'string')
          chimera['model'] = payload['chimeraModel'];
        if (typeof payload['chimeraMaxFiles'] === 'number' && payload['chimeraMaxFiles'] >= 1) {
          chimera['maxFiles'] = payload['chimeraMaxFiles'];
        }
        ext['wstack-chimera'] = chimera;
        decrypted.extensions = ext;
      }

      // Auto-review (mid-session) → extensions['wstack-auto-review'] (mirrors
      // ResolvedAutoReviewConfig from auto-review-plugin.ts:42).
      const autoReviewTouched =
        typeof payload['autoReviewEnabled'] === 'boolean' ||
        typeof payload['autoReviewProvider'] === 'string' ||
        typeof payload['autoReviewModel'] === 'string' ||
        typeof payload['autoReviewFallbackProfile'] === 'string' ||
        Array.isArray(payload['autoReviewFallbackModels']) ||
        typeof payload['autoReviewDebounceMs'] === 'number' ||
        typeof payload['autoReviewMaxFilesPerBatch'] === 'number' ||
        typeof payload['autoReviewMaxConcurrentReviews'] === 'number' ||
        typeof payload['autoReviewCascadeOn'] === 'string';
      if (autoReviewTouched) {
        const ext = (decrypted.extensions as Record<string, Record<string, unknown>>) ?? {};
        const ar = ext['wstack-auto-review'] ?? {};
        if (typeof payload['autoReviewEnabled'] === 'boolean')
          ar['enabled'] = payload['autoReviewEnabled'];
        if (typeof payload['autoReviewProvider'] === 'string')
          ar['provider'] = payload['autoReviewProvider'];
        if (typeof payload['autoReviewModel'] === 'string')
          ar['model'] = payload['autoReviewModel'];
        if (typeof payload['autoReviewFallbackProfile'] === 'string') {
          // Empty string = clear the named profile (plugin falls back to
          // resolveEffective({ fallbackAuto: true })).
          if (payload['autoReviewFallbackProfile'] === '') {
            delete ar['fallbackProfile'];
          } else {
            ar['fallbackProfile'] = payload['autoReviewFallbackProfile'];
          }
        }
        // Note: `autoReviewFallbackModels` is not a config input — it's
        // derived from `fallbackProfile` + `config.fallbackModels` by the
        // plugin's resolver. Ignore incoming writes to avoid silently
        // persisting a value that the plugin discards on every load.
        if (typeof payload['autoReviewDebounceMs'] === 'number' && payload['autoReviewDebounceMs'] >= 0) {
          ar['debounceMs'] = payload['autoReviewDebounceMs'];
        }
        if (
          typeof payload['autoReviewMaxFilesPerBatch'] === 'number' &&
          payload['autoReviewMaxFilesPerBatch'] >= 1
        ) {
          ar['maxFilesPerBatch'] = payload['autoReviewMaxFilesPerBatch'];
        }
        if (
          typeof payload['autoReviewMaxConcurrentReviews'] === 'number' &&
          payload['autoReviewMaxConcurrentReviews'] >= 1
        ) {
          ar['maxConcurrentReviews'] = payload['autoReviewMaxConcurrentReviews'];
        }
        if (typeof payload['autoReviewCascadeOn'] === 'string') {
          if (
            payload['autoReviewCascadeOn'] === 'off' ||
            payload['autoReviewCascadeOn'] === 'critical' ||
            payload['autoReviewCascadeOn'] === 'high'
          ) {
            ar['cascadeOn'] = payload['autoReviewCascadeOn'];
          }
        }
        ext['wstack-auto-review'] = ar;
        decrypted.extensions = ext;
      }

      const encrypted = encryptConfigSecrets(decrypted, vault);
      await atomicWrite(configPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
    };

    // Chain onto any in-flight write so two concurrent pref updates don't race.
    const next = prefWriteLock.then(write);
    prefWriteLock = next.then(
      () => undefined,
      () => undefined,
    );
    try {
      await next;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'warn',
          event: 'webui.prefs.persist_failed',
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  };

  return { prefSnapshot, persistPrefs };
}
