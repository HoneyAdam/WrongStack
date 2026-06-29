import type { Config, SecretVault } from '@wrongstack/core';
import { color } from '@wrongstack/core';
import type { ReadlineInputReader } from './input-reader.js';
import { loadConfigProviders, normalizeKeys } from './provider-config-utils.js';
import type { TerminalRenderer } from './renderer.js';

export type FirstRunAuthGateChoice = 'continue' | 'settings' | 'quit';

export interface FirstRunAuthGateDeps {
  config: Config;
  globalConfigPath: string;
  vault: SecretVault;
  renderer: TerminalRenderer;
  reader: ReadlineInputReader;
}

export async function hasAnyAuthRecord(deps: {
  config: Config;
  globalConfigPath: string;
  vault: SecretVault;
}): Promise<boolean> {
  if (typeof deps.config.apiKey === 'string' && deps.config.apiKey.length > 0) return true;
  const inMemoryProviders = deps.config.providers ?? {};
  for (const cfg of Object.values(inMemoryProviders)) {
    if (cfg && normalizeKeys(cfg).length > 0) return true;
  }

  const providers = await loadConfigProviders(deps.globalConfigPath, deps.vault);
  return Object.values(providers).some((cfg) => normalizeKeys(cfg).length > 0);
}

export async function promptFirstRunAuthGate(
  deps: FirstRunAuthGateDeps,
): Promise<FirstRunAuthGateChoice> {
  deps.renderer.write(
    [
      '',
      `${color.bold('WrongStack setup')}`,
      '',
      '  No saved auth record was found.',
      `  To use this tool, set a provider API key first with ${color.bold('wstack auth')},`,
      `  or sign in with ChatGPT using ${color.bold('wstack auth login chatgpt')}.`,
      '',
      `  ${color.dim('Options:')}`,
      `    ${color.bold('Y / Enter')}  Continue anyway and pick a provider/model`,
      `    ${color.bold('N')}          Open auth settings now`,
      `    ${color.bold('q')}      Quit`,
      '',
    ].join('\n'),
  );

  for (;;) {
    const answer = (
      await deps.reader.readLine(
        `${color.amber('?')} Continue without auth setup? ${color.dim('[Y/n/q]')} `,
      )
    )
      .trim()
      .toLowerCase();
    if (!answer || answer === 'c' || answer === 'continue' || answer === 'y' || answer === 'yes') {
      return 'continue';
    }
    if (
      answer === 's' ||
      answer === 'settings' ||
      answer === 'a' ||
      answer === 'auth' ||
      answer === 'no' ||
      answer === 'n'
    ) {
      return 'settings';
    }
    if (answer === 'q' || answer === 'quit' || answer === 'exit') return 'quit';
    deps.renderer.writeError(`Unknown selection: "${answer}"`);
  }
}
