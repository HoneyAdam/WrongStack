# Modern Node.js (>= 22) — WrongStack (Compact)

Node.js >= 22 patterns: ESM-only, native fetch with AbortSignal, Web Streams.

## Rules

1. Always use ESM (`import` with `.js` extension) — never `require()`.
2. Always use `node:` protocol for built-in modules.
3. Always use `AbortSignal.timeout()` for long-running operations.
4. Never use axios, node-fetch, or got — native fetch is sufficient.
5. Always handle `ENOENT` on file reads — use try/catch or `access` first.
6. Use `Promise.allSettled` when partial failure is acceptable.

## Key patterns

- **ESM**: `import * as fs from 'node:fs/promises'`, `import { helper } from './helper.js'`
- **fetch**: `const res = await fetch(url, { signal: AbortSignal.timeout(5000) })`
- **Atomic write**: write to `.tmp`, then `rename(tmp, target)`
- **Parallel**: `const results = await Promise.allSettled(tasks.map(t => t.run()))`
- **Streams**: `response.body.getReader()` with `TextDecoder`
- **AbortSignal**: Combine signals with `AbortSignal.any([userSignal, timeoutSignal])`