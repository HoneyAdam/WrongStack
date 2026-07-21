import type { SlashCommand } from '@wrongstack/core';
import { createCliSecurityCommand } from '../wiring/security-command.js';
import type { SlashCommandContext } from './index.js';

/** Thin slash-surface adapter; production behavior lives in @wrongstack/security-scanner. */
export function buildSecurityCommand(opts: SlashCommandContext): SlashCommand {
  return createCliSecurityCommand(opts);
}
