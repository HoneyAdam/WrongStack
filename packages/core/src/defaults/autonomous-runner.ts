import { randomUUID } from 'node:crypto';
import type { RunResult } from '../core/agent.js';
import type { Context, RunOptions } from '../core/context.js';
import type { Agent } from '../core/agent.js';
import type { DoneCondition } from '../types/multi-agent.js';
import { toWrongStackError } from '../types/errors.js';

export interface DoneCheckResult {
  done: boolean;
  reason?: string;
  iterations: number;
  toolCalls: number;
}

export class DoneConditionChecker {
  constructor(private readonly condition: DoneCondition) {}

  check(state: { iterations: number; toolCalls: number; lastOutput?: string }): DoneCheckResult {
    switch (this.condition.type) {
      case 'iterations':
        if (this.condition.maxIterations && state.iterations >= this.condition.maxIterations) {
          return { done: true, reason: `max iterations (${this.condition.maxIterations}) reached`, ...state };
        }
        break;

      case 'tool_calls':
        if (this.condition.maxToolCalls && state.toolCalls >= this.condition.maxToolCalls) {
          return { done: true, reason: `max tool calls (${this.condition.maxToolCalls}) reached`, ...state };
        }
        break;

      case 'output_match':
        if (this.condition.pattern && state.lastOutput) {
          const regex = new RegExp(this.condition.pattern);
          if (regex.test(state.lastOutput)) {
            return { done: true, reason: `output matched pattern "${this.condition.pattern}"`, ...state };
          }
        }
        break;

      case 'custom':
        // Reserved for future extension
        break;
    }

    return { done: false, iterations: state.iterations, toolCalls: state.toolCalls };
  }
}

export interface AutonomousRunnerOptions {
  agent: Agent;
  context: Context;
  doneCondition: DoneCondition;
  iterationTimeoutMs?: number;
  onIteration?: (state: { iteration: number; toolCalls: number }) => void;
  onDone?: (result: RunResult & { toolCalls: number; reason?: string }) => void;
}

export class AutonomousRunner {
  private iterations = 0;
  private toolCalls = 0;
  private lastOutput?: string;
  private stopped = false;
  private readonly doneChecker: DoneConditionChecker;

  constructor(private readonly opts: AutonomousRunnerOptions) {
    this.doneChecker = new DoneConditionChecker(opts.doneCondition);
  }

  async run(): Promise<RunResult & { toolCalls: number; reason?: string }> {
    while (!this.stopped) {
      const check = this.doneChecker.check({
        iterations: this.iterations,
        toolCalls: this.toolCalls,
        lastOutput: this.lastOutput,
      });

      if (check.done) {
        const result: RunResult & { toolCalls: number; reason?: string } = {
          status: 'done',
          iterations: this.iterations,
          toolCalls: this.toolCalls,
          reason: check.reason,
        };
        this.opts.onDone?.(result);
        return result;
      }

      this.opts.onIteration?.({ iteration: this.iterations, toolCalls: this.toolCalls });

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), this.opts.iterationTimeoutMs ?? 30_000);

      try {
        const result = await this.opts.agent.run(
          '',
          { signal: ctrl.signal, maxIterations: 1, executionStrategy: 'sequential' },
        );

        this.iterations++;
        this.lastOutput = result.finalText;

        this.toolCalls++;

        if (result.status === 'failed' || result.status === 'aborted') {
          const failedResult: RunResult & { toolCalls: number; reason?: string } = {
            status: result.status,
            error: result.error,
            iterations: this.iterations,
            toolCalls: this.toolCalls,
          };
          this.opts.onDone?.(failedResult);
          return failedResult;
        }
      } catch (e) {
        // Continue on tool errors, abort on fatal errors
        if ((e as Error).message.includes('timeout')) {
          const timeoutResult: RunResult & { toolCalls: number; reason?: string } = {
            status: 'failed',
            error: toWrongStackError(e),
            iterations: this.iterations,
            toolCalls: this.toolCalls,
            reason: 'iteration timeout',
          };
          this.opts.onDone?.(timeoutResult);
          return timeoutResult;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      status: 'aborted',
      iterations: this.iterations,
      toolCalls: this.toolCalls,
      reason: 'stopped externally',
    };
  }

  stop(): void {
    this.stopped = true;
  }
}