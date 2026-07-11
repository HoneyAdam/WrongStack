import { ADDITIONAL_LANGUAGE_PROFILES } from './profiles/additional.js';
import { PRIMARY_LANGUAGE_PROFILES } from './profiles/primary.js';
import type { LanguageOperation, LanguageProfile, LanguageProfileId } from './types.js';

const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const EXECUTABLE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const KNOWN_OPERATIONS = new Set<LanguageOperation>([
  'syntax',
  'semantic',
  'lint',
  'format-check',
  'format-write',
  'test-compile',
  'test',
  'build',
  'run',
  'debug-compile',
  'debug-test',
  'debug-runtime',
  'debug-race',
  'package-install',
  'package-add',
  'package-remove',
  'package-update',
  'package-audit',
  'package-outdated',
]);

export class LanguageProfileRegistry {
  readonly #profiles = new Map<LanguageProfileId, LanguageProfile>();

  constructor(profiles: readonly LanguageProfile[] = []) {
    for (const profile of profiles) this.register(profile);
  }

  register(profile: LanguageProfile): void {
    const errors = validateLanguageProfile(profile);
    if (errors.length > 0) {
      throw new Error(`Invalid language profile "${profile.id}": ${errors.join('; ')}`);
    }
    if (this.#profiles.has(profile.id)) {
      throw new Error(`Language profile "${profile.id}" is already registered`);
    }
    this.#profiles.set(profile.id, freezeProfile(profile));
  }

  get(id: LanguageProfileId): LanguageProfile | undefined {
    return this.#profiles.get(id);
  }

  list(): readonly LanguageProfile[] {
    return Object.freeze([...this.#profiles.values()]);
  }
}

export function validateLanguageProfile(profile: LanguageProfile): string[] {
  const errors: string[] = [];
  if (!PROFILE_ID_RE.test(profile.id)) errors.push('id must be a lowercase stable identifier');
  if (!profile.displayName.trim()) errors.push('displayName is required');
  if (profile.extensions.length === 0) errors.push('at least one extension is required');
  for (const ext of profile.extensions) {
    if (!/^\.[a-z0-9+.-]+$/i.test(ext)) errors.push(`invalid extension "${ext}"`);
  }
  if (profile.detectors.length === 0) errors.push('at least one detector is required');
  for (const detector of profile.detectors) {
    if ((detector.filename ? 1 : 0) + (detector.suffix ? 1 : 0) !== 1) {
      errors.push('each detector must declare exactly one of filename or suffix');
    }
    if (!Number.isFinite(detector.weight) || detector.weight <= 0 || detector.weight > 100) {
      errors.push('detector weights must be in the range 1..100');
    }
    const marker = detector.filename ?? detector.suffix ?? '';
    if (marker.includes('/') || marker.includes('\\') || marker.includes('\0')) {
      errors.push(`detector marker "${marker}" must be a basename or suffix`);
    }
  }
  if (profile.executables.length === 0) errors.push('at least one executable is required');
  for (const executable of profile.executables) {
    if (!EXECUTABLE_RE.test(executable)) errors.push(`invalid executable token "${executable}"`);
  }
  for (const operation of Object.keys(profile.operations)) {
    if (!KNOWN_OPERATIONS.has(operation as LanguageOperation)) {
      errors.push(`unknown operation "${operation}"`);
    }
    if (typeof profile.operations[operation as LanguageOperation] !== 'function') {
      errors.push(`operation "${operation}" must be a resolver function`);
    }
  }
  return [...new Set(errors)];
}

function freezeProfile(profile: LanguageProfile): LanguageProfile {
  const detectors = Object.freeze(profile.detectors.map((item) => Object.freeze({ ...item })));
  const operations = Object.freeze({ ...profile.operations });
  return Object.freeze({
    ...profile,
    extensions: Object.freeze([...profile.extensions]),
    lspLanguageIds: Object.freeze([...profile.lspLanguageIds]),
    detectors,
    ignoredDirectories: Object.freeze([...profile.ignoredDirectories]),
    packageManagers: Object.freeze([...profile.packageManagers]),
    executables: Object.freeze([...profile.executables]),
    operations,
  });
}

export const languageProfileRegistry = new LanguageProfileRegistry([
  ...PRIMARY_LANGUAGE_PROFILES,
  ...ADDITIONAL_LANGUAGE_PROFILES,
]);
