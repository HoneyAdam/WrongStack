/**
 * Bash Kill Guard — Intercepts bash kill commands and prevents them from
 * terminating WrongStack processes (either the agent itself or child processes
 * it has spawned).
 *
 * This module hooks into the bash tool's command parsing to detect and block
 * dangerous kill commands targeting protected PIDs.
 */

import { getPersistentProcessRegistry } from './process-registry-persistent.js';

export interface KillCommand {
  pid: number;
  signal?: string;
  isGroupKill: boolean;
  isAllKill: boolean;
}

// Keep patterns for documentation purposes - they're used in parseKillCommand regex

/**
 * Parse a bash command string to detect kill commands.
 */
export function parseKillCommand(command: string): KillCommand | null {
  // Normalize multiple spaces
  const normalized = command.replace(/\s+/g, ' ').trim();

  // Check for "kill" command with various forms
  // kill -9 12345
  // kill -SIGTERM 12345
  // kill 12345
  // kill -1 -12345 (group kill)

  const simpleMatch = normalized.match(/^kill\s+(-\w+)?\s+(\d+)$/);
  if (simpleMatch) {
    const signal = simpleMatch[1] ?? '-TERM';
    const pidOrGroup = simpleMatch[2];
    if (!pidOrGroup) return null;
    const isGroupKill = pidOrGroup.startsWith('-');
    const pid = isGroupKill ? parseInt(pidOrGroup.slice(1), 10) : parseInt(pidOrGroup, 10);

    return {
      pid,
      signal: signal.slice(1), // Remove leading -
      isGroupKill,
      isAllKill: false,
    };
  }

  // kill -9 or kill -SIGTERM (no PID, just signal - probably checking syntax)
  if (normalized.match(/^kill\s+-[a-zA-Z]+$/)) {
    return null;
  }

  return null;
}

/**
 * Check if a parsed kill command targets a protected WrongStack process.
 */
export async function isKillProtected(kill: KillCommand): Promise<boolean> {
  const registry = getPersistentProcessRegistry();

  // For group kills, we need to check if any protected processes are in that group
  if (kill.isGroupKill) {
    // Group kill targets all processes in a process group
    // We can't easily check if a process group contains WrongStack processes
    // without OS-specific tools, so we block group kills by default if the
    // group ID matches any known WrongStack process's group
    // For now, we'll be conservative and check all protected PIDs
    const protectedPids = await registry.getAllProtectedPids();
    return protectedPids.length > 0; // Conservative: block group kills if any protected processes exist
  }

  // Single process kill - check if the target PID is protected
  return registry.shouldBlockKill(kill.pid);
}

/**
 * Detect if a command string contains a kill operation targeting protected PIDs.
 * Returns a warning message if blocked, null otherwise.
 */
export async function checkAndBlockKillCommand(command: string): Promise<string | null> {
  const normalized = command.replace(/\s+/g, ' ').trim();

  // Only check commands that start with "kill"
  if (!normalized.startsWith('kill')) {
    return null;
  }

  const parsed = parseKillCommand(normalized);
  if (!parsed) {
    // Not a simple kill command - might be a complex one
    // Try more complex pattern matching
    return null;
  }

  if (await isKillProtected(parsed)) {
    const signal = parsed.signal ? ` (${parsed.signal})` : '';
    const groupNote = parsed.isGroupKill ? ' (process group)' : '';
    return `Blocked: kill${signal} ${parsed.pid}${groupNote} targets a protected WrongStack process (PID protected)`;
  }

  return null;
}

/**
 * Get a safe error message for blocked kill commands.
 */
export function getBlockedKillMessage(pid: number, signal?: string): string {
  return `Kill command blocked: PID ${pid}${signal ? ` (signal ${signal})` : ''} is a protected WrongStack process. ` +
    `Use 'exit' or Ctrl+C to gracefully terminate a WrongStack session.`;
}
