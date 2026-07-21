/** Identifies the isolated pre-v1 draft contract at runtime. */
export const LEGACY_ACP_CONTRACT_VERSION = 'pre-v1-draft' as const;

/**
 * @deprecated Import stable protocol contracts from `@wrongstack/acp/v1`.
 * These shapes remain available only for compatibility with older transports.
 */
export type {
  ACPImageContent,
  ACPInputSchema,
  ACPMessage,
  ACPProgressContent,
  ACPResourceContent,
  ACPSessionInfo,
  ACPTextContent,
  ACPToolCallRequest,
  ACPToolCallResponse,
  ACPToolDefinition,
  ACPToolList,
  ACPToolResult,
  ContentBlock,
} from './types/acp-messages.js';
