/**
 * Minimal Server-Sent Events parser for HTTP streaming responses.
 *
 * Yields parsed events as `{ event, data }` pairs. Per spec:
 *   - Each event is separated by a blank line
 *   - `event: foo` sets the event name (defaults to "message")
 *   - `data: ...` lines accumulate into the data buffer
 *   - `:` lines are comments and ignored
 *   - `id` / `retry` fields are accepted and ignored
 *
 * For Anthropic the wire format is canonical SSE with explicit `event:` lines.
 * For OpenAI / OpenAI-compatible the format omits `event:` and just emits
 * `data: <json>` chunks, with a final `data: [DONE]`. Both work with this
 * parser; consumers branch on event name or just on `data`.
 */
export interface SSEMessage {
  event: string;
  data: string;
}

export async function* parseSSE(
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null,
): AsyncIterable<SSEMessage> {
  if (!body) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let event = 'message';
  const dataLines: string[] = [];

  const flush = (): SSEMessage | undefined => {
    if (dataLines.length === 0 && event === 'message') return undefined;
    const data = dataLines.join('\n');
    const msg: SSEMessage = { event, data };
    event = 'message';
    dataLines.length = 0;
    return msg;
  };

  const processLine = (line: string): SSEMessage | undefined => {
    if (line === '') return flush();
    if (line.startsWith(':')) return undefined; // comment
    const colonIdx = line.indexOf(':');
    let field: string;
    let value: string;
    if (colonIdx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }
    if (field === 'event') event = value || 'message';
    else if (field === 'data') dataLines.push(value);
    // id / retry: ignored
    return undefined;
  };

  // Node.js Readable stream
  if (isNodeReadable(body)) {
    for await (const chunk of body as NodeJS.ReadableStream) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk as Buffer, { stream: true });
      const lines = splitBuffer(buffer);
      buffer = lines.tail;
      for (const line of lines.lines) {
        const msg = processLine(line);
        if (msg) yield msg;
      }
    }
  } else {
    // Web ReadableStream
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = splitBuffer(buffer);
        buffer = lines.tail;
        for (const line of lines.lines) {
          const msg = processLine(line);
          if (msg) yield msg;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  // Flush any trailing buffered line
  if (buffer.length > 0) {
    const msg = processLine(buffer);
    if (msg) yield msg;
  }
  const final = flush();
  if (final) yield final;
}

function splitBuffer(buf: string): { lines: string[]; tail: string } {
  // Normalize \r\n to \n, then split by \n. Last fragment without trailing \n is held.
  const norm = buf.replace(/\r\n/g, '\n');
  const parts = norm.split('\n');
  const tail = parts.pop() ?? '';
  return { lines: parts, tail };
}

function isNodeReadable(b: unknown): boolean {
  return (
    !!b &&
    typeof b === 'object' &&
    typeof (b as { pipe?: unknown }).pipe === 'function' &&
    typeof (b as { on?: unknown }).on === 'function'
  );
}
