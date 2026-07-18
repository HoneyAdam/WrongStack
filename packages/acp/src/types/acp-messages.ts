/**
 * ACP message types — transport-agnostic JSON-RPC 2.0 envelope.
 * Reuses MCP types where possible; custom types for agentic UX (diffs, plans).
 */
export interface ACPMessage {
  method: string;
  id?: string | number | undefined;
  params?: unknown | undefined;
  result?: unknown | undefined;
  error?: ACPError | undefined;
}

interface ACPError {
  code: number;
  message: string;
  data?: unknown | undefined;
}

export interface ACPToolList {
  tools: ACPToolDefinition[];
}

// --- Tools ---
export interface ACPToolDefinition {
  name: string;
  description?: string | undefined;
  inputSchema: ACPInputSchema;
  annotations?: {
    title?: string | undefined;
    description?: string | undefined;
    priority?: 'high' | 'medium' | 'low' | undefined;
    alwaysAccept?: boolean | undefined;
  };
}

export type ACPInputSchema = {
  type?: string | undefined;
  properties?: Record<string, ACPInputSchema>;
  required?: string[] | undefined;
  items?: ACPInputSchema | undefined;
  enum?: unknown[] | undefined;
  description?: string | undefined;
  default?: unknown | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  [key: string]: unknown;
};

// --- Content blocks ---
export type ContentBlock =
  | ACPTextContent
  | ACPResourceContent
  | ACPImageContent
  | ACPProgressContent;

export interface ACPTextContent {
  type: 'text';
  text: string;
}

export interface ACPResourceContent {
  type: 'resource';
  resource: {
    type: string;
    uri: string;
    data?: string | undefined;
    mimeType?: string | undefined;
  };
}

export interface ACPImageContent {
  type: 'image';
  data: string; // base64
  mimeType?: string | undefined;
}

export interface ACPProgressContent {
  type: 'progress';
  id: string;
  label?: string | undefined;
  message?: string | undefined;
  messages?: string[] | undefined;
}

// --- Tool calls ---
export interface ACPToolCallRequest {
  method: 'tools/call';
  id: string | number;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ACPToolResult {
  content: ContentBlock[];
  isError?: boolean | undefined;
}

export type ACPToolCallResponse = {
  method: 'tools/call';
  id: string | number;
  result: ACPToolResult;
};

// --- Session list ---
export interface ACPSessionInfo {
  sessionId: string;
  path: string;
  title?: string | undefined;
  modelId?: string | undefined;
  createdAt: string;
  lastActiveAt: string;
}
