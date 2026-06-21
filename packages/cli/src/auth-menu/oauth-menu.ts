import { color } from '@wrongstack/core';
import { runClaudeOAuthLogin } from './anthropic-oauth.js';
import { runCopilotOAuthLogin } from './github-copilot-oauth.js';
import { runCodexOAuthLogin } from './openai-codex-oauth.js';
import type { AuthMenuDeps } from './types.js';

/** Render subscription OAuth login choices shared by the top menu and add flow. */
export function renderOAuthLoginOptions(deps: AuthMenuDeps, indent = '    '): void {
  deps.renderer.write(
    `${indent}${color.bold('OAuth login options')} ${color.dim('(subscription sign-in)')}\n` +
      `${indent}${color.bold('chatgpt')}  ChatGPT Plus/Pro  ${color.dim('(→ openai-codex)')}\n` +
      `${indent}${color.bold('claude')}   Claude Pro/Max    ${color.dim('(→ anthropic-oauth)')}\n` +
      `${indent}${color.bold('copilot')}  GitHub Copilot    ${color.dim('(→ github-copilot)')}\n`,
  );
}

/** Run an OAuth login for a normalized menu choice. Returns true when handled. */
export async function runOAuthLoginChoice(
  deps: AuthMenuDeps,
  choice: string,
  opts: { allowNumeric?: boolean } = {},
): Promise<boolean> {
  const pick = choice.trim().toLowerCase();
  const allowNumeric = opts.allowNumeric ?? true;
  if ((allowNumeric && pick === '1') || pick === 'chatgpt' || pick === 'openai' || pick === 'codex') {
    await runCodexOAuthLogin(deps);
    return true;
  }
  if ((allowNumeric && pick === '2') || pick === 'claude' || pick === 'anthropic') {
    await runClaudeOAuthLogin(deps);
    return true;
  }
  if ((allowNumeric && pick === '3') || pick === 'copilot' || pick === 'github' || pick === 'github-copilot') {
    await runCopilotOAuthLogin(deps);
    return true;
  }
  return false;
}

/** Sub-menu: pick a subscription to sign in with (OAuth). */
export async function runOAuthLoginMenu(deps: AuthMenuDeps): Promise<void> {
  deps.renderer.write(
    `\n  ${color.bold('Login with OAuth:')}\n` +
      color.amber('  ⚠ Subscription tokens used outside official clients may violate provider\n') +
      color.amber('    Terms — your account could be rate-limited or banned. An API key is the\n') +
      color.dim('    sanctioned path for programmatic use.\n') +
      `    ${color.bold('1')}  ChatGPT Plus/Pro  ${color.dim('(→ openai-codex)')}\n` +
      `    ${color.bold('2')}  Claude Pro/Max    ${color.dim('(→ anthropic-oauth)')}\n` +
      `    ${color.bold('3')}  GitHub Copilot    ${color.dim('(→ github-copilot)')}\n`,
  );
  const pick = await deps.reader.readLine(`  ${color.amber('?')} Pick ${color.dim('(or b to go back)')}: `);
  await runOAuthLoginChoice(deps, pick);
}
