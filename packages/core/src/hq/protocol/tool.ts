import type { HqPathPolicy } from './project.js';

export type HqToolArgsPolicy = 'none' | 'summary' | 'redacted' | 'full';

export interface HqRedactionPolicy {
  rawContent: boolean;
  toolArgs: HqToolArgsPolicy;
  paths: HqPathPolicy;
}

export const DEFAULT_HQ_REDACTION_POLICY: HqRedactionPolicy = {
  rawContent: true,
  toolArgs: 'full',
  paths: 'full',
};

/**
 * Per-string cap applied when redacting chat-transcript events
 * (`session.transcript` / `agent.message`). The generic 500-char summary cap
 * is right for telemetry rollups but would mangle full chat-history rendering
 * in the HQ Console once `rawContent` is enabled — messages and tool outputs
 * routinely exceed it. Applied publisher-side AND at the server's re-redaction
 * so both hops agree.
 */
export const HQ_TRANSCRIPT_TEXT_CAP = 16_000;

export interface HqToolStartedPayload {
  toolName: string;
  capabilities?: readonly string[];
  risk?: string;
  inputSummary?: unknown;
}

export interface HqToolCompletedPayload {
  toolName: string;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  outputSummary?: unknown;
  errorClass?: string;
}
