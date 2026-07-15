export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'thinking' | 'assistant' | 'system';
  text: string;
  streaming?: boolean | undefined;
  ts?: string | undefined;
}

export interface SessionInfo {
  id: string;
  provider: string;
  model: string;
  projectName: string;
  cwd: string;
  maxContext: number;
}

export interface SimpleSessionSummary {
  id: string;
  title: string;
  name?: string | undefined;
  startedAt: string;
  model: string;
  provider: string;
  isCurrent: boolean;
}

export interface ContextInfo {
  load: number;
  tokens: number;
  maxContext: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  contextWindow?: number | undefined;
}

export interface ProviderModels {
  provider: string;
  label: string;
  models: ModelDescriptor[];
}

export interface SimpleSubagent {
  id: string;
  name: string;
  status: string;
  task?: string | undefined;
  model?: string | undefined;
}

export type AgentTranscriptKind =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'status'
  | 'system';

export interface AgentTranscriptEntry {
  id: string;
  subagentId: string;
  agentName: string;
  content: string;
  kind: AgentTranscriptKind;
  iteration: number;
  ts: string;
  toolName?: string | undefined;
  toolOk?: boolean | undefined;
}

export interface AgentSessionReplay {
  subagentId: string;
  agentName: string;
  status: string;
  task?: string | undefined;
  transcript: AgentTranscriptEntry[];
}

export interface PendingConfirm {
  id: string;
  toolName: string;
  input: unknown;
  riskTier?: string | undefined;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  output?: string | undefined;
  durationMs?: number | undefined;
  ok?: boolean | undefined;
}

export interface ServerMessage {
  type: string;
  payload?: Record<string, unknown> | undefined;
}
