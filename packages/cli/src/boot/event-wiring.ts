import { randomBytes } from 'node:crypto';
import type { EventBus } from '@wrongstack/core';
import { color, writeErr } from '@wrongstack/core';
import { Spinner } from '../spinner.js';

export interface EventWiringRenderer {
  write(text: string): void;
}

export type EvOn = (
  event: string,
  // biome-ignore lint/suspicious/noExplicitAny: dynamic event dispatch — callers use typed payloads
  handler: (...args: any) => void,
) => void;

export interface WireEventWiringDeps {
  evOn: EvOn;
  events: EventBus;
  renderer: EventWiringRenderer;
  getProvider: () => string;
  getModel: () => string;
  projectSlug: string;
  getActiveModeId: () => string;
  tuiOwnsScreen: boolean;
}

export interface EventWiring {
  setEffectiveMaxContext: (maxContext: number) => void;
}

/** Wire CLI spinner, live streaming, and client.status emission. */
export function wireEventWiring(deps: WireEventWiringDeps): EventWiring {
  const { evOn, events, renderer, projectSlug, getActiveModeId, getProvider, getModel } = deps;
  const spinner = new Spinner(process.stderr, { enabled: !deps.tuiOwnsScreen });
  let lastInputTokens = 0;
  let effectiveMaxContext = 0;
  let streamingActive = false;
  const cliClientId = `cli@${randomBytes(4).toString('hex')}`;
  let cliToolCalls = 0;
  let cliInputTokens = 0;
  let cliOutputTokens = 0;
  let cliCacheTokens = 0;
  let cliCostUsd = 0;

  const updateSpinnerContext = (): void => {
    spinner.setContext(
      effectiveMaxContext > 0 && lastInputTokens > 0
        ? { used: lastInputTokens, max: effectiveMaxContext }
        : undefined,
    );
  };

  const closeStreamingLine = (): void => {
    if (!streamingActive) return;
    renderer.write('\n');
    streamingActive = false;
  };

  const stopSpinnerAndStreaming = (): void => {
    spinner.stop();
    closeStreamingLine();
  };

  const emitClientStatus = (): void => {
    events.emit('client.status', {
      clientType: 'cli',
      clientId: cliClientId,
      projectHash: projectSlug,
      agentCount: 1,
      model: getModel(),
      mode: getActiveModeId(),
      toolCalls: cliToolCalls,
      inputTokens: cliInputTokens,
      outputTokens: cliOutputTokens,
      cacheTokens: cliCacheTokens,
      costUsd: cliCostUsd,
      timestamp: Date.now(),
      projectSlug,
    });
  };

  evOn('provider.response', (e: { usage?: { input?: number } }) => {
    lastInputTokens = e.usage?.input ?? 0;
    updateSpinnerContext();
    spinner.stop();
  });

  evOn('iteration.started', () => {
    updateSpinnerContext();
    spinner.start(color.dim(`${getProvider()}/${getModel()} thinking…`));
  });
  evOn('error', () => spinner.stop());

  evOn('provider.text_delta', (p: { text: string }) => {
    if (!streamingActive) {
      spinner.stop();
      streamingActive = true;
    }
    renderer.write(p.text);
  });
  evOn('iteration.completed', closeStreamingLine);

  evOn('provider.retry', (p: { delayMs: number; attempt: number; description: string }) => {
    stopSpinnerAndStreaming();
    const secs = (p.delayMs / 1000).toFixed(p.delayMs >= 1000 ? 1 : 2);
    writeErr(color.yellow(`  ⟳ retry ${p.attempt} in ${secs}s — ${p.description}\n`));
    spinner.start(color.dim(`${getProvider()}/${getModel()} thinking…`));
  });

  evOn('provider.fallback', (p: { status: number; to: { providerId: string; model: string } }) => {
    stopSpinnerAndStreaming();
    writeErr(
      color.yellow(`  ↻ rate-limited (${p.status}) — switched to ${p.to.providerId}/${p.to.model}\n`),
    );
    spinner.start(color.dim(`${p.to.providerId}/${p.to.model} thinking…`));
  });

  evOn('provider.error', (p: { description: string }) => {
    stopSpinnerAndStreaming();
    writeErr(color.red(`  ✗ ${p.description}\n`));
  });

  evOn('tool.executed', () => {
    cliToolCalls++;
    emitClientStatus();
  });

  evOn(
    'provider.response',
    (e: { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }) => {
      if (e.usage) {
        cliInputTokens = e.usage.input ?? cliInputTokens;
        cliOutputTokens = e.usage.output ?? cliOutputTokens;
        cliCacheTokens = (e.usage.cacheRead ?? 0) + (e.usage.cacheWrite ?? 0);
      }
      emitClientStatus();
    },
  );

  evOn('token.accounted', (e: { cost: { total: number } }) => {
    cliCostUsd = e.cost.total;
    emitClientStatus();
  });
  evOn('iteration.completed', emitClientStatus);
  emitClientStatus();

  return {
    setEffectiveMaxContext: (maxContext: number): void => {
      effectiveMaxContext = maxContext;
      updateSpinnerContext();
    },
  };
}
