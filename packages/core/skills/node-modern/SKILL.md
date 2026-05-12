---
name: node-modern
description: |
  Use this skill for Node.js >= 22 idioms: ESM-only, native fetch, AbortSignal,
  node: protocol imports, structuredClone, Web Streams, and modern async patterns.
version: 1.0.0
---

# Modern Node.js (>= 22)

## Imports

- Always use `node:` protocol for built-ins: `import * as fs from 'node:fs/promises'`.
- ESM only — no CommonJS in new code. Use `.js` extension in relative imports.
- Prefer `import.meta` over `__dirname` (compute via `fileURLToPath`).

## I/O

- Use `fs.promises` (or `node:fs/promises`). Avoid the callback API.
- Use native `fetch` — no axios, no node-fetch.
- Use `AbortSignal` everywhere that takes time: fetch, child_process spawn, timers (via `setTimeout(..., { signal })`).

## Patterns

```ts
// Combine signals
const combined = AbortSignal.any([userSignal, timeoutSignal]);

// Atomic write
import { rename, writeFile } from 'node:fs/promises';
const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
await writeFile(tmp, data);
await rename(tmp, target);
```

## Anti-patterns

- `require()` in new code
- `__dirname` without `fileURLToPath`
- Mixing `fs.readFile` callback with `await`
- Swallowing AbortError silently
