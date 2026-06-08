import type { ModelsRegistry, SecretVault } from '@wrongstack/core';
import type { ReadlineInputReader } from '../input-reader.js';
import type { TerminalRenderer } from '../renderer.js';

/**
 * Dependencies shared across all auth-menu modules.
 * Kept deliberately light — each sub-module takes only the subset it needs.
 */
export interface AuthMenuDeps {
  renderer: TerminalRenderer;
  reader: ReadlineInputReader;
  modelsRegistry: ModelsRegistry;
  vault: SecretVault;
  globalConfigPath: string;
}
