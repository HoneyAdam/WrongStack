import {
  type BootConfigOptions,
  type Config,
  type DefaultPathResolver,
  type WstackPaths,
  bootConfig as coreBootConfig,
} from '@wrongstack/core';

export interface BootPaths {
  cwd: string;
  projectRoot: string;
  userHome: string;
  wpaths: WstackPaths;
  pathResolver: DefaultPathResolver;
}

export interface BootConfigResult {
  paths: BootPaths;
  config: Config;
  vault: BootConfigVault;
}

/** The concrete vault type returned by the core boot routine. */
type BootConfigVault = Awaited<ReturnType<typeof coreBootConfig>>['vault'];

/**
 * Thin CLI wrapper over the canonical `bootConfig` in `@wrongstack/core`.
 * Re-shapes the core result into the CLI's historical `{ paths, config, vault }`
 * return type. All real boot behavior (path resolution, vault, secret
 * migration, config + sync loading) lives in core so the CLI and the WebUI
 * server can't drift.
 */
export async function bootConfig(
  flags: Record<string, string | boolean>,
): Promise<BootConfigResult> {
  const opts: BootConfigOptions = { flags, appLabel: 'wstack' };
  const { cwd, projectRoot, userHome, wpaths, pathResolver, config, vault } =
    await coreBootConfig(opts);
  return {
    paths: { cwd, projectRoot, userHome, wpaths, pathResolver },
    config,
    vault,
  };
}
