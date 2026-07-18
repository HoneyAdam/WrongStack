import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownComponents, rehypePlugins } from '../../src/components/MessageBubble/utils.js';

describe('message code block copy', () => {
  const writeText = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('copies highlighted SQL as plain source text', async () => {
    const sql = [
      'select code, title',
      'from public.exam_categories',
      'where exam_config_id = 42 and is_active = true',
      'order by order_index;',
    ].join('\n');

    render(
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {`\`\`\`sql\n${sql}\n\`\`\``}
      </ReactMarkdown>,
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sql));
    expect(writeText.mock.calls[0]?.[0]).not.toContain('[object Object]');
  });
});
