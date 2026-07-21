import type {
  Config,
  Context,
  EnhanceFailureKind,
  MemoryStore,
  ModelsRegistry,
  Provider,
  ProviderConfig,
} from '@wrongstack/core';
import {
  buildRefinerContextSections,
  enhanceUserPrompt,
  gatedEnhancerReasoning,
  nextEnhanceTimeout,
  recentTextTurns,
  resolveConfiguredRefinerRef,
  resolveEnhanceFallbackRef,
} from '@wrongstack/core';
import { toErrorMessage } from '@wrongstack/core/utils';
import type { WebSocket } from 'ws';
import { resolveProviderModelMetadata } from './model-catalog.js';
import type { WSServerMessage } from './types.js';
import { validateModelSwitchPayload } from './ws-payload-validation.js';

export interface ModelRefinePayload {
  text: string;
  timeoutMs?: number | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  previousRefined?: string | undefined;
  previousEnglish?: string | undefined;
  retryFeedback?: string | undefined;
}

export interface ModelOperationsContext {
  context: Context;
  memoryStore?: MemoryStore | undefined;
  modelsRegistry?: ModelsRegistry | undefined;
  getConfig: () => Config | undefined;
  getLiveProviderId: () => string;
  buildProvider: (providerId: string, config: ProviderConfig) => Provider | Promise<Provider>;
  applyModelSwitch: (providerId: string, modelId: string) => Promise<void>;
  send: (ws: WebSocket, message: WSServerMessage) => void;
  log?: ((message: string) => void) | undefined;
}

function sendResult(
  context: ModelOperationsContext,
  ws: WebSocket,
  success: boolean,
  message: string,
): void {
  context.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

export function createModelOperations(context: ModelOperationsContext) {
  async function switchModel(ws: WebSocket, input: unknown): Promise<void> {
    const parsed = validateModelSwitchPayload(input);
    if (!parsed.ok) {
      sendResult(context, ws, false, parsed.message);
      return;
    }
    const { provider, model } = parsed.value;
    try {
      await context.applyModelSwitch(provider, model);
      sendResult(context, ws, true, `Switched to ${provider} / ${model}`);
    } catch (error) {
      sendResult(context, ws, false, `Switch failed: ${toErrorMessage(error)}`);
    }
  }

  async function buildTargetProvider(
    providerId: string,
    config: Config | undefined,
  ): Promise<Provider> {
    return context.buildProvider(
      providerId,
      config?.providers?.[providerId] ?? { type: providerId },
    );
  }

  async function refineModel(ws: WebSocket, payload: ModelRefinePayload): Promise<void> {
    const text = payload.text;
    if (!text?.trim()) {
      context.send(ws, {
        type: 'model.refine_result',
        payload: { refined: '', english: '', error: 'Empty text', errorKind: 'provider_error' },
      });
      return;
    }

    const config = context.getConfig();
    const liveProviderId = context.getLiveProviderId();
    const liveModel = context.context.model;
    const fallbackRef = config
      ? resolveEnhanceFallbackRef({ ...config, provider: liveProviderId, model: liveModel })
      : undefined;
    let provider = context.context.provider;
    let providerId = liveProviderId;
    let model = liveModel;

    if (payload.provider && payload.model) {
      try {
        provider = await buildTargetProvider(payload.provider, config);
        providerId = payload.provider;
        model = payload.model;
      } catch (error) {
        context.send(ws, {
          type: 'model.refine_result',
          payload: {
            refined: text,
            english: text,
            error: `Cannot use ${payload.provider}/${payload.model}: ${toErrorMessage(error)}`,
            errorKind: 'provider_error',
            ...(fallbackRef ? { fallbackRef } : {}),
          },
        });
        return;
      }
    } else if (config) {
      const configuredRef = resolveConfiguredRefinerRef({
        ...config,
        provider: liveProviderId,
        model: liveModel,
      });
      if (configuredRef) {
        const slash = configuredRef.indexOf('/');
        const configuredProvider = slash > 0 ? configuredRef.slice(0, slash) : liveProviderId;
        const configuredModel = slash > 0 ? configuredRef.slice(slash + 1) : configuredRef;
        try {
          provider = await buildTargetProvider(configuredProvider, config);
          providerId = configuredProvider;
          model = configuredModel;
        } catch {
          // An unavailable dedicated refiner must not block the live model.
        }
      }
    }

    const timeoutMs =
      typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0 ? payload.timeoutMs : 90_000;
    try {
      const history = recentTextTurns(context.context.messages);
      const contextSections = await buildRefinerContextSections({
        text,
        memoryStore: context.memoryStore,
        context: context.context,
      });
      const resolved = context.modelsRegistry
        ? await resolveProviderModelMetadata(
            context.modelsRegistry,
            providerId,
            model,
            config?.providers?.[providerId],
          ).catch(() => undefined)
        : undefined;
      const reasoning = gatedEnhancerReasoning(resolved?.capabilities.reasoningConfig as never);
      let failureKind: EnhanceFailureKind | undefined;
      const result = await enhanceUserPrompt({
        provider,
        model,
        text,
        history,
        contextSections,
        ...(payload.previousRefined
          ? {
              previousRefinement: {
                refined: payload.previousRefined,
                english: payload.previousEnglish || payload.previousRefined,
              },
            }
          : {}),
        ...(payload.retryFeedback ? { retryFeedback: payload.retryFeedback } : {}),
        timeoutMs,
        ...(reasoning ? { reasoning } : {}),
        onError: (reason, kind) => {
          failureKind = kind;
          context.log?.(
            JSON.stringify({
              level: 'warn',
              event: 'model.refine_failed',
              reason,
              kind,
              provider: providerId,
              model,
              timestamp: new Date().toISOString(),
            }),
          );
        },
      });
      if (result) {
        context.send(ws, {
          type: 'model.refine_result',
          payload: {
            refined: result.refined,
            english: result.english,
            refinedWith: { provider: providerId, model },
          },
        });
        return;
      }
      context.send(ws, {
        type: 'model.refine_result',
        payload: {
          refined: text,
          english: text,
          error: 'Refinement returned no result',
          errorKind: failureKind ?? 'empty',
          ...(failureKind === 'timeout'
            ? { retryTimeoutMs: nextEnhanceTimeout(timeoutMs, config?.autonomy) }
            : {}),
          ...(fallbackRef ? { fallbackRef } : {}),
        },
      });
    } catch (error) {
      context.log?.(
        JSON.stringify({
          level: 'error',
          event: 'model.refine.error',
          error: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        }),
      );
      context.send(ws, {
        type: 'model.refine_result',
        payload: {
          refined: text,
          english: text,
          error: toErrorMessage(error),
          errorKind: 'provider_error',
          ...(fallbackRef ? { fallbackRef } : {}),
        },
      });
    }
  }

  return { switchModel, refineModel };
}
