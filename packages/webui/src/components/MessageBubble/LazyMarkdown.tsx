import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Lazy-loaded wrapper around ReactMarkdown + remark-gfm.
 *
 * react-markdown, remark-gfm, and rehype-highlight together pull in
 * ~536KB (166KB gzipped). Loading them eagerly puts the entire markdown
 * pipeline in the initial bundle — even before the user sees a single
 * chat message. By deferring to a lazy chunk, the initial load is
 * smaller and the markdown pipeline is fetched on first render of a
 * message that actually contains markdown.
 *
 * The `components` and `rehypePlugins` props are passed through
 * unchanged so callers (MessageBubble, StreamingMarkdown, etc.) keep
 * their custom renderers and syntax-highlighting plugins.
 */
const ReactMarkdownLazy = lazy(() => import('react-markdown'));

/**
 * Drop-in replacement for `<ReactMarkdown>` that splits the heavy
 * markdown dependencies into a separate lazy chunk.
 *
 * A `<Suspense>` fallback of `null` is used because the parent
 * component already handles the empty/loading state — when markdown is
 * streaming, the tail renders as plain text (see StreamingMarkdown).
 */
export function LazyMarkdown(props: ComponentProps<typeof ReactMarkdownLazy>) {
  return (
    <Suspense fallback={null}>
      <ReactMarkdownLazy {...props} />
    </Suspense>
  );
}
