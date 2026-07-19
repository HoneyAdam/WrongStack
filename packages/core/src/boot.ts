import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EventBus } from './kernel/events.js';
import { DefaultLogger, noOpLogger } from './infrastructure/logger.js';
import { DefaultPathResolver } from './infrastructure/path-resolver.js';
import { DefaultSecretVault, migratePlaintextSecrets } from './security/secret-vault.js';
import { DefaultConfigLoader } from './storage/config-loader.js';
import { type Config, normalizeTokenSavingTier } from './types/config.js';
import { safeParse } from './utils/safe-json.js';
import { writeErr } from './utils/term.js';
import { toErrorMessage } from './utils/error.js';
import { atomicWrite } from './utils/atomic-write.js';
import {
  canonicalProjectRoot,
  type WstackPaths,
  resolveWstackPaths,
} from './utils/wstack-paths.js';

/**
 * Options for {@link bootConfig}. Both the CLI and the WebUI server boot the
 * same way; the only intentional differences are the label used in the
 * plaintext-secret migration notice and whether CLI flags are supplied.
 */
export interface BootConfigOptions {
  /**
   * Parsed CLI flags. `cwd` relocates path resolution; `provider`/`model`/
   * `log-level`/`verbose`/`trace`/`yolo`/`no-features` are patched into the
   * loaded config (see {@link flagsToConfigPatch}). Defaults to `{}` (the
   * WebUI server passes no flags).
   */
  flags?: Record<string, string | boolean>;
  /**
   * Label shown in the `[<label>] Encrypted N plaintext secret(s) in FILE`
   * stderr notice emitted when legacy plaintext secrets get auto-encrypted.
   * The CLI passes `wstack`; the WebUI server passes `WebUI`. Default
   * `wstack`.
   */
  appLabel?: string | undefined;
  /**
   * Load `~/.wrongstack/sync.json` and merge it into `config.sync` so the
   * ConfigStore starts with the correct CloudSync state. Default `true`.
   */
  loadSyncConfig?: boolean | undefined;
  /**
   * Skip the provider/model identity validation during config load. When
   * `true`, a missing provider or model in config does NOT throw — the
   * boot caller is responsible for handling the missing-provider case
   * (e.g. showing a setup screen). Used by `--webui` mode so the WebUI
   * can boot without a configured provider and show the setup screen.
   */
  skipIdentityValidation?: boolean | undefined;
}

/**
 * Everything the boot phase resolves before DI-container wiring. Superset of
 * what the CLI and WebUI server each consumed previously, so both can pick the
 * fields they need from a single canonical result.
 */
export interface BootConfigResult {
  cwd: string;
  projectRoot: string;
  userHome: string;
  wpaths: WstackPaths;
  pathResolver: DefaultPathResolver;
  config: Config;
  vault: DefaultSecretVault;
  logger: DefaultLogger;
  /** Convenience alias for `wpaths.globalConfig`. */
  globalConfigPath: string;
}

/**
 * Canonical boot routine shared by `@wrongstack/cli` and `@wrongstack/webui`.
 * Resolves paths, creates the real AES-GCM secret vault, migrates any
 * plaintext secrets, loads + merges config (with CLI-flag overrides and an
 * optional sync overlay), and builds a logger.
 *
 * The per-package `bootConfig()` wrappers re-shape this result into their own
 * legacy return types for backward compatibility — keep this the single source
 * of boot behavior so the two consumers can't drift.
 */
export async function bootConfig(options: BootConfigOptions = {}): Promise<BootConfigResult> {
  const { flags = {}, appLabel = 'wstack', loadSyncConfig = true, skipIdentityValidation = false } = options;

  const cwd = typeof flags['cwd'] === 'string' ? path.resolve(flags['cwd']) : process.cwd();
  const pathResolver = new DefaultPathResolver(cwd);
  const projectRoot = pathResolver.projectRoot;
  const projectIdentityRoot = canonicalProjectRoot(projectRoot);
  const userHome = os.homedir();
  // No explicit userHome here: that would defeat the WRONGSTACK_HOME env
  // override (tests / sandboxed runs redirect all global state through it).
  const wpaths = resolveWstackPaths({ projectRoot });

  // Ensure the directories every consumer relies on exist. This is the union
  // of what the cli and webui boot paths created independently — creating all
  // three eagerly is harmless and removes the "new wpath added to one copy
  // only" drift hazard.
  await fs.mkdir(wpaths.globalRoot, { recursive: true });
  await fs.mkdir(wpaths.profilesDir, { recursive: true });
  await fs.mkdir(wpaths.projectDir, { recursive: true });
  await fs.mkdir(wpaths.projectSessions, { recursive: true });
  await writeProjectMeta(wpaths, projectIdentityRoot);
  // Also register/update the project in ~/.wrongstack/projects.json
  await registerProjectInManifest(
    wpaths,
    projectIdentityRoot,
    undefined,
    cwd !== projectIdentityRoot ? cwd : undefined,
  );
  await ensureGitignore(projectRoot);

  // ═════════════════════════════════════════════════════════════════════
  // Legacy config migration: move ~/.wrongstack/config.json content into
  // ~/.wrongstack/profiles/default/config.json BEFORE any config load.
  // Starting with 0.291.0 the root config is a thin bootstrap pointer
  // (version + activeProfile); all user settings live in the profile config.
  // ═════════════════════════════════════════════════════════════════════
  await migrateLegacyConfig(wpaths);

  // ═════════════════════════════════════════════════════════════════════
  // Profile-file migration: copy statusline.json, mode.json,
  // provider-status.json, and update-cache.json from the global root into
  // the active profile's directory if they don't exist there yet.
  // ═════════════════════════════════════════════════════════════════════
  await migrateProfileFiles(wpaths);

  // Clean up stale project directories left behind by tests or deleted
  // working directories.  Best-effort — never blocks boot.
  cleanupStaleProjects(wpaths).catch((err) => {
    noOpLogger.debug('cleanupStaleProjects failed', { err });
  });

  // Preliminary logger — created before config load so both the vault and
  // config loader have a structured Logger for their warnings. Uses the
  // env-level or 'info' (handled by DefaultLogger constructor); replaced
  // with the properly-configured logger once config is loaded.
  const bootLogger = new DefaultLogger({ stderr: true });

  // Vault must come first so the config loader can decrypt apiKey-like fields.
  // It lazily creates ~/.wrongstack/.key on first encrypt/decrypt.
  const vault = new DefaultSecretVault({ keyFile: wpaths.secretsKey, logger: bootLogger });

  // Auto-encrypt any plaintext secrets still sitting in config files (left
  // over from before the vault existed, or hand-written). Silent no-op for
  // already-encrypted configs; never blocks boot on migration issues.
  // Uses noOpLogger because the structured logger isn't built until after
  // config loads; migration is best-effort and the warning it would emit
  // (permission errors on restrictFilePermissions) is the same one the
  // main logger would surface on the next boot.
  // Also migrate secrets in the default profile config (other profiles
  // will be migrated on first load via ensureProfileConfig).
  // Defensive: profileConfig may not be available in test mocks.
  const bootstrapProfilePath =
    typeof wpaths.profileConfig === 'function' ? wpaths.profileConfig('default') : null;
  const secretFiles = [wpaths.globalConfig, wpaths.projectLocalConfig].filter(Boolean) as string[];
  if (bootstrapProfilePath) secretFiles.push(bootstrapProfilePath);
  for (const file of secretFiles) {
    try {
      const { migrated } = await migratePlaintextSecrets(file, vault, noOpLogger);
      if (migrated > 0) {
        writeErr(`[${appLabel}] Encrypted ${migrated} plaintext secret(s) in ${file}\n`);
      }
    } catch {
      // best-effort — never block boot on migration issues
    }
  }

  const configLoader = new DefaultConfigLoader({ paths: wpaths, vault, logger: bootLogger });
  let config: Config;
  try {
    config = await configLoader.load({ cliFlags: flagsToConfigPatch(flags) });
  } catch (err) {
    if (
      skipIdentityValidation &&
      err instanceof Error &&
      err.message.includes('no provider configured')
    ) {
      // --webui mode: boot without a configured provider. Do not inject
      // a provider/model identity here; downstream setup state must stay
      // visibly unconfigured until the user picks a real target.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'boot.no_provider_configured',
          app: appLabel,
          message: 'No provider configured — setup screen will be shown',
          timestamp: new Date().toISOString(),
        }),
      );
      try {
        config = await configLoader.load({ cliFlags: flagsToConfigPatch(flags), skipIdentityValidation: true });
      } catch (fallbackErr) {
        // Best-effort: if even the skip-validation load fails (corrupt config,
        // FS error), create a minimal in-memory config so --webui can still show
        // the setup screen instead of crashing at boot.
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'boot.config_fallback',
            message: `Config load fallback triggered: ${toErrorMessage(fallbackErr)}`,
            timestamp: new Date().toISOString(),
          }),
        );
        config = Object.freeze({}) as Config;
      }
    } else {
      throw err;
    }
  }

  // Load and decrypt sync config from ~/.wrongstack/sync.json and merge it into
  // the main config so ConfigStore starts with the correct sync state.
  // `load()` returns a frozen Config, so rebuild a new frozen object rather
  // than mutating in place (a direct assignment throws "Cannot add property
  // sync, object is not extensible" once sync.json exists).
  if (loadSyncConfig) {
    const syncConfig = await configLoader.loadSyncConfig();
    if (syncConfig) {
      config = Object.freeze({ ...config, sync: syncConfig }) as Config;
    }
  }

  const logger = new DefaultLogger({ level: config.log?.level ?? 'info', file: wpaths.logFile });

  // Initialize the cross-process session registry so /sessions status works
  // and the agent status tracker can register entries later.
  try {
    const { getSessionRegistry } = await import('./session-registry.js');
    getSessionRegistry(wpaths.globalRoot);
  } catch {
    // Non-critical — session tracking degrades gracefully
  }

  return {
    cwd,
    projectRoot,
    userHome,
    wpaths,
    pathResolver,
    config,
    vault,
    logger,
    globalConfigPath: wpaths.globalConfig,
  };
}

/**
 * Translate parsed CLI flags into a partial Config patch applied on top of the
 * file-loaded config. Explicit `--log-level` wins over `--verbose`/`--trace`.
 */
export function flagsToConfigPatch(flags: Record<string, string | boolean>): Partial<Config> {
  const patch: Partial<Config> = {};
  if (typeof flags['provider'] === 'string') patch.provider = flags['provider'];
  if (typeof flags['model'] === 'string') patch.model = flags['model'];
  if (typeof flags['fallback-model'] === 'string') {
    const list = flags['fallback-model']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) patch.fallbackModels = list;
  }
  if (typeof flags['cwd'] === 'string') patch.cwd = flags['cwd'];
  if (typeof flags['log-level'] === 'string') {
    patch.log = { level: flags['log-level'] as Config['log']['level'] };
  } else if (flags['verbose']) {
    patch.log = { level: 'debug' };
  } else if (flags['trace']) {
    patch.log = { level: 'trace' };
  }
  if (flags['no-yolo'] === true) patch.yolo = false;
  else if (flags['yolo']) patch.yolo = true;
  if (flags['no-features']) {
    patch.features = {
      mcp: false,
      plugins: false,
      memory: false,
      modelsRegistry: false,
      skills: false,
    };
  }
  if (flags['token-saving-mode']) {
    patch.features ??= {} as Config['features'];
    patch.features.tokenSavingMode = true;
  }
  // `--token-saving-tier <level>` takes precedence over `--token-saving-mode`.
  // Supported values: off, minimal, light, medium, aggressive.
  if (typeof flags['token-saving-tier'] === 'string') {
    patch.features ??= {} as Config['features'];
    patch.features.tokenSavingMode = normalizeTokenSavingTier(
      flags['token-saving-tier'] as 'off' | 'minimal' | 'light' | 'medium' | 'aggressive',
    );
  }
  return patch;
}

/**
 * Before 0.291.0, all config lived in ~/.wrongstack/config.json.
 * Starting with 0.291.0, the root config is a thin bootstrap (version +
 * activeProfile) and settings live in ~/.wrongstack/profiles/<name>/config.json.
 *
 * This function migrates a legacy flat config into the default profile config
 * BEFORE any config loader runs, so the loader always reads from the right place.
 *
 * MANDATORY: if profiles/default/config.json is empty or missing AND the old
 * root config has meaningful content, the migration MUST happen — no skip paths.
 * The only conditions that genuinely prevent migration are:
 *   - Root config file doesn't exist (nothing to migrate)
 *   - Root config content is not valid JSON (can't parse)
 *   - Filesystem error creating the profiles directory (hard error, not skippable)
 */
async function migrateLegacyConfig(wpaths: WstackPaths): Promise<void> {
  const rootFp = wpaths.globalConfig;
  const profileFp = wpaths.profileConfig('default');

  // Check if the profile file has any meaningful content.
  // If it's empty (0 bytes), just `{}`, or contains only bootstrap-like keys
  // (version, activeProfile), treat it as "doesn't exist" and migrate into it.
  let profileHasContent = false;
  try {
    const profileRaw = await fs.readFile(profileFp, 'utf8');
    const trimmed = profileRaw.trim();
    if (trimmed.length > 0 && trimmed !== '{}') {
      const parsed = safeParse<Record<string, unknown>>(trimmed);
      if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
        const keys = Object.keys(parsed.value);
        const onlyBootstrapKeys = keys.length > 0 && keys.every((k) => k === 'version' || k === 'activeProfile');
        if (!onlyBootstrapKeys) {
          profileHasContent = true;
        }
      }
    }
  } catch {
    // ENOENT or read error → profile doesn't exist or is unreadable, proceed
  }
  if (profileHasContent) return;

  // If legacy root doesn't exist, nothing to migrate.
  let legacyRaw: string;
  try {
    legacyRaw = await fs.readFile(rootFp, 'utf8');
  } catch {
    return; // ENOENT or other error — nothing to migrate
  }

  // Validate the legacy content is parseable JSON with actual settings.
  const result = safeParse<Record<string, unknown>>(legacyRaw);
  if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    return;
  }

  // Ensure the profiles directory exists.
  await fs.mkdir(wpaths.profilesDir, { recursive: true });

  // Copy legacy content into the profile config, stripping bootstrap-only fields.
  const profileContent = { ...result.value };
  delete profileContent['activeProfile'];

  await atomicWrite(profileFp, JSON.stringify(profileContent, null, 2), { mode: 0o600 });

  // Write the root config as a thin bootstrap pointer.
  const activeProfile =
    typeof result.value['activeProfile'] === 'string'
      ? result.value['activeProfile']
      : 'default';
  const bootstrap = { version: 1, activeProfile };

  try {
    await atomicWrite(rootFp, JSON.stringify(bootstrap, null, 2), { mode: 0o600 });
  } catch {
    // best-effort — profile already migrated
  }
}

/** Pairs of (global source, profile destination) that need migration. */
const PROFILE_FILE_PAIRS: ReadonlyArray<{
  globalSrc: (wpaths: WstackPaths) => string;
  profileDst: (wpaths: WstackPaths, name: string) => string;
}> = [
  {
    globalSrc: (w) => path.join(w.globalRoot, 'statusline.json'),
    profileDst: (w, n) => w.profileStatuslineConfig(n),
  },
  {
    globalSrc: (w) => path.join(w.globalRoot, 'mode.json'),
    profileDst: (w, n) => w.profileModeConfig(n),
  },
  {
    globalSrc: (w) => path.join(w.globalRoot, 'provider-status.json'),
    profileDst: (w, n) => w.profileProviderStatus(n),
  },
  {
    globalSrc: (w) => path.join(w.globalRoot, 'update-cache.json'),
    profileDst: (w, n) => w.profileUpdateCache(n),
  },
];

/**
 * Migrate profile-scoped files (statusline.json, mode.json,
 * provider-status.json, update-cache.json) from the global root into the
 * active profile's directory. Runs after migrateLegacyConfig() so the
 * active profile name is resolved from the now-migrated root bootstrap.
 *
 * For each file: if it exists in the profile directory, it's left untouched
 * (idempotent). If it's missing in the profile but exists at the global root,
 * it's copied into the profile. If neither exists, silently skipped.
 * Best-effort: failures never block boot.
 */
async function migrateProfileFiles(wpaths: WstackPaths): Promise<void> {
  // Read the active profile name from the bootstrap (already migrated by
  // migrateLegacyConfig above). Default to 'default' if unset.
  let profileName = 'default';
  try {
    const raw = await fs.readFile(wpaths.globalConfig, 'utf8');
    const parsed = safeParse<Record<string, unknown>>(raw);
    if (parsed.ok && parsed.value && typeof parsed.value.activeProfile === 'string') {
      profileName = parsed.value.activeProfile;
    }
  } catch {
    // best-effort — default profile
  }

  // Ensure the profile directory exists so the copy targets are writable.
  try {
    await fs.mkdir(path.join(wpaths.profilesDir, profileName), { recursive: true });
  } catch {
    return;
  }

  for (const pair of PROFILE_FILE_PAIRS) {
    const src = pair.globalSrc(wpaths);
    const dst = pair.profileDst(wpaths, profileName);

    // Skip if the profile already has this file (idempotent).
    try {
      await fs.access(dst);
      continue; // profile file already exists
    } catch {
      // doesn't exist — proceed to check global source
    }

    // If the global source doesn't exist, nothing to do.
    try {
      await fs.access(src);
    } catch {
      continue;
    }

    // Copy the global file into the profile directory.
    try {
      const content = await fs.readFile(src, 'utf8');
      await fs.writeFile(dst, content, { mode: 0o600, encoding: 'utf8' });
    } catch {
      // best-effort — never block boot
    }
  }
}

async function writeProjectMeta(paths: WstackPaths, projectRoot: string): Promise<void> {
  try {
    await fs.mkdir(paths.projectDir, { recursive: true });
    const meta = {
      hash: paths.projectHash,
      slug: paths.projectSlug,
      root: projectRoot,
      lastSeen: new Date().toISOString(),
    };
    await fs.writeFile(paths.projectMeta, JSON.stringify(meta, null, 2));
  } catch {
    // best-effort
  }
}

/**
 * Register or update the current project in ~/.wrongstack/projects.json.
 * This is the central manifest that the /project command uses.
 */
async function registerProjectInManifest(
  paths: WstackPaths,
  projectRoot: string,
  events?: EventBus,
  /** Working directory when it differs from projectRoot (e.g. subdirectory launch). */
  workingDir?: string,
): Promise<void> {
  const manifestPath = path.join(paths.globalRoot, 'projects.json');

  // Read existing manifest (best-effort — missing or malformed file is treated as empty)
  try {
    const t0 = Date.now();
    const raw = await fs.readFile(manifestPath, 'utf8');
    events?.emit('storage.read', {
      sessionId: '~boot~',
      store: 'project',
      filePath: manifestPath,
      operation: 'manifest_read',
      outcome: 'success',
      durationMs: Date.now() - t0,
    });
    try {
      JSON.parse(raw); // validate
    } catch {
      // treat malformed JSON as empty manifest — will be overwritten
    }
  } catch (err) {
    events?.emit('storage.error', {
      sessionId: '~boot~',
      store: 'project',
      filePath: manifestPath,
      operation: 'manifest_read',
      error: toErrorMessage(err),
      recoverable: true,
    });
  }

  // Write updated manifest
  try {
    let manifest: { projects: Array<{ name: string; root: string; slug: string; lastSeen?: string; createdAt?: string; lastWorkingDir?: string }> };
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      manifest = JSON.parse(raw);
    } catch {
      manifest = { projects: [] };
    }

    const now = new Date().toISOString();
    const existing = manifest.projects.find((p) => p.root === projectRoot);
    if (existing) {
      existing.lastSeen = now;
      if (workingDir) existing.lastWorkingDir = workingDir;
    } else {
      const slug = paths.projectSlug;
      const name = path.basename(projectRoot);
      const entry: Record<string, string | undefined> = { name, root: projectRoot, slug, lastSeen: now, createdAt: now };
      if (workingDir) entry.lastWorkingDir = workingDir;
      manifest.projects.push(entry as typeof manifest.projects[0]);
    }

    const writeT0 = Date.now();
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    events?.emit('storage.write', {
      sessionId: '~boot~',
      store: 'project',
      filePath: manifestPath,
      operation: 'manifest_write',
      outcome: 'success',
      durationMs: Date.now() - writeT0,
    });
  } catch (err) {
    events?.emit('storage.error', {
      sessionId: '~boot~',
      store: 'project',
      filePath: manifestPath,
      operation: 'manifest_write',
      error: toErrorMessage(err),
      recoverable: false,
    });
    // best-effort — never blocks boot
  }
}

const GITIGNORE_ENTRY = '.wrongstack/\n';

/**
 * Ensure `.gitignore` exists in the project root and contains `.wrongstack/`.
 * Idempotent — skips if the entry is already present. Best-effort — failures
 * are silently ignored so boot never blocks on gitignore maintenance.
 */
async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  try {
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf8');
    } catch {
      // file doesn't exist — that's fine, we'll create it
    }
    if (!content.includes('.wrongstack')) {
      const updated = content
        ? content.endsWith('\n')
          ? content + GITIGNORE_ENTRY
          : content + '\n' + GITIGNORE_ENTRY
        : GITIGNORE_ENTRY;
      await fs.writeFile(gitignorePath, updated, 'utf8');
    }
  } catch {
    // best-effort — never blocks boot
  }
}

/**
 * Remove project directories whose original `root` no longer exists on
 * disk (e.g. temp directories from tests, deleted working copies).  Runs
 * as a fire-and-forget best-effort — failures are silently ignored.
 */
async function cleanupStaleProjects(wpaths: WstackPaths): Promise<void> {
  const projectsRoot = path.dirname(wpaths.projectDir);
  let entries;
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist or can't be read
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(projectsRoot, entry.name, 'meta.json');
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as { root?: string | undefined };
      if (typeof meta.root === 'string') {
        try {
          await fs.access(meta.root);
          // root still exists — keep it
        } catch {
          // root gone → remove the entire project directory
          await fs.rm(path.join(projectsRoot, entry.name), { recursive: true, force: true });
        }
      }
    } catch {
      // no readable meta.json → leave it alone (don't nuke ambiguous dirs)
    }
  }
}
