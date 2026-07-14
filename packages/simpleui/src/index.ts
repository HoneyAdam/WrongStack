export const SIMPLEUI_SURFACE = 'simpleui' as const;
export {
  contentToText,
  replayToMessages,
  updateSubagents,
} from './lib/chat-model.js';
export { projectAssistantMessage } from './lib/message-projection.js';
export type { AssistantMessageProjection } from './lib/message-projection.js';
