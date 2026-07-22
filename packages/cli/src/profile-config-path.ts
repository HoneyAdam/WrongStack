import type { Config } from '@wrongstack/core/types';
import type { WstackPaths } from '@wrongstack/core/utils';

/** Resolve the selected profile without ever treating the root bootstrap as settings. */
export function activeProfileName(config: Pick<Config, 'activeProfile'>): string {
  return typeof config.activeProfile === 'string' && config.activeProfile.trim()
    ? config.activeProfile
    : 'default';
}

/** Canonical settings file for the currently selected profile. */
export function activeProfileConfigPath(
  paths: Pick<WstackPaths, 'profileConfig'>,
  config: Pick<Config, 'activeProfile'>,
): string {
  return paths.profileConfig(activeProfileName(config));
}
