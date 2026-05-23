---
name: node-modern
description: |
  Use this skill when writing, reviewing, or refactoring Node.js >= 22
  TypeScript code in WrongStack. Triggers: ESM imports, fetch usage, AbortSignal,
  node: protocol, Web Streams, or any async patterns.
version: 1.1.0
---

# Modern Node.js (>= 22) — WrongStack

## Imports — always ESM

```ts
// ✅ Always — node: protocol for built-ins
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

// ✅ ESM with .js extension in relative imports
import { helper } from './helper.js';
import { types } from '../types/index.js';

// ❌ Never — CommonJS
const fs = require('fs/promises');
```

## fetch — native only

```ts
// ✅ Native fetch (Node 18+)
const res = await fetch('https://api.example.com/data', {
  signal: AbortSignal.timeout(5000),
});

// ❌ Never — axios, node-fetch, got
const res = await axios.get('https://api.example.com/data');
```

## AbortSignal — everywhere that takes time

```ts
// ✅ Timeout on fetch
await fetch(url, { signal: AbortSignal.timeout(5000) });

// ✅ Timeout on child_process
const child = spawn('pnpm', ['test'], { signal: AbortSignal.timeout(30_000) });

// ✅ Combined signals
const combined = AbortSignal.any([userSignal, timeoutSignal]);

// ✅ setTimeout with signal (Node 22+)
setTimeout(handler, 1000, { signal: userSignal });
```

## Async patterns

```ts
// ✅ Atomic write pattern
import { rename, writeFile } from 'node:fs/promises';
const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
await writeFile(tmp, data);
await rename(tmp, target);

// ✅ Sequential with error handling
for (const file of files) {
  try {
    await processFile(file);
  } catch (err) {
    console.error(`Failed ${file}: ${err}`);
  }
}

// ✅ Parallel with allSettled (when partial failure is ok)
const results = await Promise.allSettled(tasks.map(t => t.run()));
const failures = results.filter(r => r.status === 'rejected');
```

## Web Streams

```ts
// ✅ Readable stream from fetch
const response = await fetch('https://api.example.com/stream');
const reader = response.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value));
}
```

## Anti-patterns

| Anti-pattern | Why bad | Fix |
|---|---|---|
| `require()` in new code | WrongStack uses ESM | Use `import` with `.js` extension |
| `__dirname` without `fileURLToPath` | ESM doesn't have `__dirname` | `path.dirname(fileURLToPath(import.meta.url))` |
| Mixing `fs.readFile` callback with `await` | Callback API doesn't return a promise | Use `fs.promises.readFile` |
| Swallowing `AbortError` silently | Means timeout/abort happened | Log it or handle explicitly |
| `process.cwd()` without fallback | May not match user's cwd | Accept `cwd` as a parameter |
| Not handling `ENOENT` on file reads | File may not exist | Use try/catch or `access` first |

## package.json scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "test": "vitest run"
  }
}
```

## TypeScript config for Node 22+

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  }
}
```

## Skills in scope

- `typescript-strict` — strict TypeScript patterns
- `react-modern` — React Server Components with Node.js
- `bug-hunter` — catching async/await bugs, unhandled rejections