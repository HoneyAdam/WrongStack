import { useChatStore, useSessionStore } from '@/stores';

/**
 * Build a markdown export of the current chat and trigger a browser download.
 */
export function downloadChatAsMarkdown(): void {
  const messages = useChatStore.getState().messages;
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  lines.push('# WrongStack chat export');
  lines.push(`*Exported: ${new Date().toISOString()}*`);
  lines.push('');
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push('## 👤 User');
      lines.push('');
      lines.push(m.content);
      lines.push('');
    } else if (m.role === 'assistant') {
      lines.push('## 🤖 Assistant');
      lines.push('');
      lines.push(m.content);
      lines.push('');
    } else if (m.role === 'tool') {
      const status = m.isError ? '❌' : m.toolResult !== undefined ? '✅' : '⏳';
      lines.push(`### 🔧 Tool: \`${m.toolName ?? 'unknown'}\` ${status}`);
      if (m.toolInput !== undefined) {
        lines.push('```json');
        lines.push(JSON.stringify(m.toolInput, null, 2));
        lines.push('```');
      }
      if (m.toolResult) {
        lines.push('<details><summary>Output</summary>');
        lines.push('');
        lines.push('```');
        lines.push(m.toolResult);
        lines.push('```');
        lines.push('</details>');
      }
      lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wrongstack-chat-${now}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build a stand-alone HTML export of the current chat. Self-contained
 * (inline CSS, no external assets) so the file opens cleanly anywhere.
 */
export function downloadChatAsHtml(): void {
  const messages = useChatStore.getState().messages;
  const session = useSessionStore.getState();
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const turns = messages.map((m) => {
    if (m.role === 'tool') {
      const status = m.isError ? '❌' : m.toolResult !== undefined ? '✅' : '⏳';
      return `
        <section class="bubble tool ${m.isError ? 'error' : ''}">
          <header><span class="icon">🔧</span><code>${escapeHtml(m.toolName ?? 'tool')}</code> ${status}</header>
          ${
            m.toolInput !== undefined
              ? `<details><summary>Input</summary><pre>${escapeHtml(JSON.stringify(m.toolInput, null, 2))}</pre></details>`
              : ''
          }
          ${
            m.toolResult
              ? `<details><summary>Output</summary><pre>${escapeHtml(m.toolResult)}</pre></details>`
              : ''
          }
        </section>`;
    }
    const cls = m.role === 'user' ? 'user' : 'assistant';
    const icon = m.role === 'user' ? '👤' : '🤖';
    const role = m.role === 'user' ? 'User' : 'Assistant';
    return `
      <section class="bubble ${cls}">
        <header><span class="icon">${icon}</span><strong>${role}</strong></header>
        <pre class="content">${escapeHtml(m.content)}</pre>
      </section>`;
  });

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>WrongStack chat — ${escape(session.session?.title || session.projectName || 'export')}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 920px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .bubble { margin: 12px 0; padding: 10px 14px; border-radius: 10px; border: 1px solid #ddd; }
  .bubble header { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #666; margin-bottom: 6px; }
  .bubble header .icon { margin-right: 4px; }
  .bubble.user { background: #eef4ff; border-color: #c8d8f5; }
  .bubble.assistant { background: #fff; }
  .bubble.tool { background: #fafafa; }
  .bubble.tool.error { background: #fff5f5; border-color: #f5c8c8; }
  pre.content, .bubble pre { white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; margin: 0; }
  details summary { cursor: pointer; color: #555; font-size: 12px; }
  details pre { margin-top: 6px; background: #f4f4f4; padding: 8px; border-radius: 6px; max-height: 360px; overflow: auto; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d0d0f; color: #e6e6e6; }
    .bubble { border-color: #2a2a2e; }
    .bubble.user { background: #16213a; border-color: #2a3d6b; }
    .bubble.assistant { background: #161618; }
    .bubble.tool { background: #131315; }
    .bubble.tool.error { background: #2a1717; border-color: #5c2a2a; }
    details pre { background: #1a1a1c; }
    .meta, .bubble header, details summary { color: #999; }
  }
</style>
</head><body>
<h1>WrongStack chat — ${escape(session.session?.title || session.projectName || 'export')}</h1>
<div class="meta">
  Exported ${new Date().toISOString()}${session.session?.provider ? ` · ${escape(session.session.provider)}/${escape(session.session.model)}` : ''} · ${messages.length} message${messages.length === 1 ? '' : 's'}
</div>
${turns.join('')}
</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wrongstack-chat-${now}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
