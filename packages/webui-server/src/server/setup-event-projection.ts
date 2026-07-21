/** Host ports for sensitive and high-volume EventBus projections. */
export interface SetupEventProjection {
  scrubObject?: ((value: unknown) => unknown) | undefined;
  queueTextDelta?: ((text: string, sessionId?: string) => void) | undefined;
  queueThinkingDelta?: ((text: string, sessionId?: string) => void) | undefined;
  queueToolProgress?: ((payload: Record<string, unknown>) => void) | undefined;
  flushThinkingDelta?: (() => void) | undefined;
  flushAllStreamBuffers?: (() => void) | undefined;
}
