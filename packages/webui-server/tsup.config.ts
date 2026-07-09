import { defineConfig } from 'tsup';

// PR-018b extracted @wrongstack/webui/server into a new workspace package
// (audit §3.1.1 — option A: new package). The server entry points are emitted
// here; @wrongstack/webui no longer ships server code.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'server/entry': 'src/server/entry.ts',
    'server/handlers': 'src/server/handlers/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2023',
  // The `wstackui-server` bin in this package maps to dist/server/entry.js.
  // Without a shebang line the OS doesn't know to launch it with Node, so the
  // bin is unusable after `npm i -g`. tsup doesn't have a per-entry banner
  // option for ESM, so we patch it in post-build.
  onSuccess: async () => {
    const fs = await import('node:fs/promises');
    const path = 'dist/server/entry.js';
    try {
      const src = await fs.readFile(path, 'utf8');
      if (!src.startsWith('#!')) {
        await fs.writeFile(path, `#!/usr/bin/env node\n${src}`);
      }
    } catch {
      /* dist not produced yet on a partial build — skip silently. */
    }
  },
});