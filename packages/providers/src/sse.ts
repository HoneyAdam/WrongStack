import { isNodeReadable } from './object-utils.js';

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

/**
 * Cap on the unconsumed buffer (pending tail + chunk list). A malicious or
 * buggy upstream that sends megabytes without a newline could otherwise pin
 * a worker. 256 KB comfortably accommodates any sane SSE event while
 * ensuring we fail fast on garbage.
 */
const MAX_BUFFER_BYTES = 256 * 1024;

export async function* parseSSE(
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null,
): AsyncIterable<SSEMessage> {
  if (!body) return;
  const decoder = new TextDecoder('utf-8');
  // `pending` holds the unconsumed tail across chunks. We push new chunks
  // onto `chunks` so we never re-copy already-buffered data; the tail is
  // materialized into a single string for line scanning only when a
  // newline arrives. The running `totalLen` tracks unconsumed bytes only,
  // so the MAX_BUFFER_BYTES cap stays accurate after partial consumption.
  const chunks: string[] = [];
  let totalLen = 0;
  let pending = '';
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

  // Append without copying the existing tail: push into the chunk list and
  // bump the length counter. The tail is only joined when we need to scan it
  // for newlines (i.e. when a newline arrives). Trailing CR (split across
  // chunks) is handled by the per-line endsWith('\r') strip.
  const appendChunk = (chunkStr: string): void => {
    if (chunkStr.length === 0) return;
    totalLen += chunkStr.length;
    if (totalLen > MAX_BUFFER_BYTES) {
      throw new Error(
        `SSE: pending line exceeds ${MAX_BUFFER_BYTES} bytes — upstream is not framing events`,
      );
    }
    if (pending.length === 0) {
      pending = chunkStr;
    } else {
      chunks.push(pending);
      pending = chunkStr;
    }
  };

  // Scan only the unconsumed tail once per chunk. When the chunk list has
  // more than one entry we materialize it once (this happens only on the
  // chunk boundaries where lines actually cross, not every chunk). For the
  // common case of one-line-at-a-time arrivals this stays a pure indexOf
  // walk over a single string. Returns the parsed messages to the caller
  // because arrow functions can't yield from an enclosing generator.
  const consumeLines = (): SSEMessage[] => {
    const tail = chunks.length === 0 ? pending : (chunks.shift() ?? '') + pending;
    const buf = chunks.length === 0 ? tail : tail + chunks.join('');
    chunks.length = 0;
    pending = '';
    const out: SSEMessage[] = [];
    let start = 0;
    const len = buf.length;
    for (let i = 0; i < len; i++) {
      if (buf.charCodeAt(i) !== 0x0a) continue;
      const end = i > start && buf.charCodeAt(i - 1) === 0x0d ? i - 1 : i;
      const line = buf.slice(start, end);
      start = i + 1;
      const msg = processLine(line);
      if (msg) out.push(msg);
    }
    if (start < len) {
      pending = buf.slice(start);
      totalLen = pending.length;
    } else {
      totalLen = 0;
    }
    return out;
  };

  // Node.js Readable stream
  if (isNodeReadable(body)) {
    for await (const chunk of body as NodeJS.ReadableStream) {
      appendChunk(
        typeof chunk === 'string' ? chunk : decoder.decode(chunk as Buffer, { stream: true }),
      );
      for (const msg of consumeLines()) yield msg;
    }
  } else {
    // Web ReadableStream
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appendChunk(decoder.decode(value, { stream: true }));
        for (const msg of consumeLines()) yield msg;
      }
    } finally {
      reader.releaseLock();
    }
  }
  // Flush any trailing buffered line (strip a final lone CR if the stream
  // ended without a closing newline).
  if (pending.length > 0) {
    const msg = processLine(pending.charCodeAt(pending.length - 1) === 0x0d ? pending.slice(0, -1) : pending);
    if (msg) yield msg;
  }
  const final = flush();
  if (final) yield final;
}
