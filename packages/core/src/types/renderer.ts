import type { ContentBlock, TextBlock } from './blocks.js';

export interface Renderer {
  write(text: string | TextBlock): void;
  writeLine(text?: string): void;
  writeBlock(block: ContentBlock): void;
  writeToolCall(name: string, input: unknown): void;
  writeToolResult(name: string, content: unknown, isError: boolean): void;
  writeDiff(unifiedDiff: string): void;
  writeWarning(text: string): void;
  writeError(text: string): void;
  writeInfo(text: string): void;
  clear(): void;
}
