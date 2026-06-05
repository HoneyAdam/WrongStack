import { Box, Text } from 'ink';
import React from 'react';
import { type Lang, detectLang } from '../../highlight.js';
import { MarkdownView } from '../../markdown.js';
import { theme } from '../../theme.js';
import { CodeBlock } from './code-block.js';
import type { BodySegment } from './types.js';

/**
 * Horizontal columns consumed by every bordered message panel.
 * Exported so the regression test can assert against the same number
 * the Entry uses — drift between the two would silently re-introduce a bug.
 */
export const MESSAGE_PANEL_CHROME_WIDTH = 2;

/** Max code-block lines rendered before a "+N more" footer (mirrors ToolStreamBox). */

/**
 * Split assistant text into prose and ```fenced``` code segments, in order.
 * Pure + testable. An unterminated fence treats the remainder as code.
 */
export function splitFencedBlocks(text: string): BodySegment[] {
  const lines = text.split('\n');
  const segs: BodySegment[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let lang: Lang = 'plain';
  const flushProse = () => {
    if (prose.length > 0) {
      segs.push({ type: 'prose', text: prose.join('\n') });
      prose = [];
    }
  };
  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (code === null) {
        flushProse();
        code = [];
        lang = detectLang(fence[1] ?? '');
      } else {
        segs.push({ type: 'code', text: code.join('\n'), lang });
        code = null;
        lang = 'plain';
      }
      continue;
    }
    if (code !== null) code.push(line);
    else prose.push(line);
  }
  if (code !== null) segs.push({ type: 'code', text: code.join('\n'), lang });
  flushProse();
  return segs;
}

/**
 * Assistant message body: prose (with markdown tables) interleaved with
 * highlighted code blocks.
 */
export function AssistantBody({
  text,
  termWidth,
  contentWidth,
}: {
  text: string;
  termWidth: number;
  /** Real inner width of the surrounding panel. Defaults to `termWidth`. */
  contentWidth?: number;
}): React.ReactElement {
  const segments = splitFencedBlocks(text);
  const inner = contentWidth ?? termWidth;
  return (
    <Box flexDirection="column">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segment order is stable
          <CodeBlock key={i} code={seg.text} lang={seg.lang ?? 'plain'} contentWidth={inner} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segment order is stable
          <MarkdownView key={i} text={seg.text} termWidth={inner} />
        ),
      )}
    </Box>
  );
}

/**
 * The live "ASSISTANT: (streaming...)" tail shown below committed history.
 */
export function AssistantTail({ text }: { text: string }): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="single"
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderColor={theme.assistant}
      paddingLeft={1}
    >
      <Box flexDirection="row">
        <Text bold color={theme.assistant}>
          {'ASSISTANT'}
        </Text>
        <Text dimColor>{'  (streaming…)'}</Text>
      </Box>
      <Text color="white">{text}</Text>
    </Box>
  );
}
