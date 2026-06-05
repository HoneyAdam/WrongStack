import type { AISpecBuilder, AISpecPhase, DefaultTaskStore, TaskTracker } from '@wrongstack/core';
import { SpecVersioning } from '@wrongstack/core';
import type { SlashCommandContext } from '../index.js';

/** Key used to store SDD session state in ctx.meta for session isolation. */
export const SDD_META_KEY = 'sdd.state';

/** Single shared SDD session state for the process lifetime. */
export class SDDState {
  private builder: AISpecBuilder | null = null;
  private taskStore: DefaultTaskStore | null = null;
  private taskTracker: TaskTracker | null = null;
  private taskGraphId: string | null = null;
  private sessionStartTime: number = Date.now();
  private phaseStartTime: number = Date.now();
  private versioning: SpecVersioning | null = null;

  getBuilder(): AISpecBuilder | null { return this.builder; }
  setBuilder(b: AISpecBuilder | null) { this.builder = b; }
  getTaskStore(): DefaultTaskStore | null { return this.taskStore; }
  setTaskStore(s: DefaultTaskStore | null) { this.taskStore = s; }
  getTaskTracker(): TaskTracker | null { return this.taskTracker; }
  setTaskTracker(t: TaskTracker | null) { this.taskTracker = t; }
  getTaskGraphId(): string | null { return this.taskGraphId; }
  setTaskGraphId(id: string | null) { this.taskGraphId = id; }
  getSessionStartTime(): number { return this.sessionStartTime; }
  setSessionStartTime(t: number) { this.sessionStartTime = t; }
  setPhaseStartTime(t: number) { this.phaseStartTime = t; }
  getPhaseStartTime(): number { return this.phaseStartTime; }
  getSessionElapsed(): number { return Date.now() - this.sessionStartTime; }
  getPhaseElapsed(): number { return Date.now() - this.phaseStartTime; }
  getVersioning(): SpecVersioning {
    if (this.versioning === null) this.versioning = new SpecVersioning();
    return this.versioning;
  }

  clearTaskState(): void {
    this.taskStore = null;
    this.taskTracker = null;
    this.taskGraphId = null;
  }

  getContext(): string | null {
    if (!this.builder) return null;
    const session = this.builder.getSession();
    if (session.phase === 'done') return null;
    return this.builder.getAIPrompt();
  }

  getPhase(): AISpecPhase | null {
    return this.builder?.getPhase() ?? null;
  }
}

/** Process-lifetime singleton — used when no Context is available (CLI single-session mode). */
export const sddState = new SDDState();

/**
 * Get or create the SDD state for the current session.
 * Uses ctx.meta so each concurrent browser/REPL session has isolated state.
 */
export function getSessionState(ctx: SlashCommandContext['context']): SDDState {
  if (!ctx) return sddState;
  let state = ctx.meta[SDD_META_KEY] as SDDState | undefined;
  if (!state) {
    state = new SDDState();
    ctx.meta[SDD_META_KEY] = state;
  }
  return state;
}
