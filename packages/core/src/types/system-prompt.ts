import type { TextBlock } from './blocks.js';
import type { Tool } from './tool.js';

export interface BuildContext {
  cwd: string;
  projectRoot: string;
  tools: Tool[];
  /** Provider id (e.g. "anthropic", "minimax-coding-plan"). */
  provider?: string;
  /** Model id (e.g. "claude-sonnet-4-6", "MiniMax-M2.7"). */
  model?: string;
}

export interface SystemPromptBuilder {
  build(ctx: BuildContext): Promise<TextBlock[]>;
}
