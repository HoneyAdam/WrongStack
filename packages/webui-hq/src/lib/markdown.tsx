/**
 * Markdown renderer for the HQ Console — the same stack the main WebUI chat
 * uses (react-markdown + GFM + highlight.js), with a custom code renderer:
 * language badge, line count, copy button, and a line-number-free scrollable
 * block. Inline code stays inline.
 *
 * @module lib/markdown
 */
import type React from 'react';
import { isValidElement, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { CopyButton } from './copy-button.js';

/** Recursively flatten a React children tree to plain text (for copy). */
function childrenToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (isValidElement(node)) {
    return childrenToText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

const components = {
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="hq-md-table-wrap">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => {
    // The inner <code> carries language-xxx; unwrap so we control the frame.
    const code = Array.isArray(children) ? children[0] : children;
    const props = isValidElement(code)
      ? (code.props as { className?: string; children?: React.ReactNode })
      : undefined;
    const lang = /language-(\w+)/.exec(props?.className ?? '')?.[1];
    const text = childrenToText(props?.children).replace(/\n$/, '');
    const lines = text === '' ? 0 : text.split('\n').length;
    return (
      <div className="hq-md-code">
        <div className="hq-md-code-bar">
          <span className="hq-md-code-lang">{lang ?? 'text'}</span>
          <span className="hq-md-code-meta">
            {lines} line{lines === 1 ? '' : 's'}
          </span>
          <CopyButton text={text} />
        </div>
        <pre>{children}</pre>
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="hq-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
