import type {
  HookEntry,
  HookEvent,
  HookMatcher,
  InProcessHook,
  ShellHook,
} from '../types/hooks.js';

/**
 * Registry of lifecycle hooks (both in-process and shell). One instance is
 * shared per session: the boot path loads `config.hooks` as shell entries and
 * plugins add in-process entries via `PluginAPI.registerHook`. The
 * `HookRunner` reads from it at each lifecycle phase.
 */
export class HookRegistry {
  private readonly entries: HookEntry[] = [];

  /** Register an in-process hook. Returns an unsubscribe function. */
  registerInProcess(
    event: HookEvent,
    matcher: HookMatcher | undefined,
    hook: InProcessHook,
    owner?: string | undefined,
  ): () => void {
    const entry: HookEntry = {
      kind: 'inprocess',
      event,
      matcher: matcher ?? '*',
      hook,
      owner,
    };
    this.entries.push(entry);
    return () => this.remove(entry);
  }

  /** Register a single shell hook. Returns an unsubscribe function. */
  registerShell(event: HookEvent, hook: ShellHook): () => void {
    const entry: HookEntry = {
      kind: 'shell',
      event,
      matcher: hook.matcher ?? '*',
      command: hook.command,
      timeoutMs: hook.timeoutMs,
    };
    this.entries.push(entry);
    return () => this.remove(entry);
  }

  /** Bulk-load shell hooks from a `config.hooks` map. */
  loadShellHooks(hooks: Partial<Record<HookEvent, ShellHook[]>> | undefined): void {
    if (!hooks) return;
    for (const [event, list] of Object.entries(hooks) as [HookEvent, ShellHook[] | undefined][]) {
      for (const h of list ?? []) {
        if (h?.command) this.registerShell(event, h);
      }
    }
  }

  /** All entries registered for an event, in registration order. */
  list(event: HookEvent): readonly HookEntry[] {
    return this.entries.filter((e) => e.event === event);
  }

  /** True when any entry is registered for the event. */
  has(event: HookEvent): boolean {
    return this.entries.some((e) => e.event === event);
  }

  /** Drop every registered hook (used in teardown / tests). */
  clear(): void {
    this.entries.length = 0;
  }

  private remove(entry: HookEntry): void {
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
  }
}

/**
 * Does a hook matcher apply to a tool name? `*` (or empty) matches everything;
 * otherwise the matcher is a case-insensitive pipe-delimited list of exact
 * tool names (`"edit|write"`). Non-tool events pass `undefined` and always match.
 */
export function hookMatcherMatches(matcher: HookMatcher, toolName: string | undefined): boolean {
  if (!matcher || matcher === '*') return true;
  if (toolName === undefined) return true;
  const target = toolName.toLowerCase();
  return matcher
    .split('|')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}
