import { defineConfig } from 'tsup';

const skipDts = process.env.WRONGSTACK_SKIP_DTS === '1';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: skipDts ? false : true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2023',
  // Externalize every @wrongstack/* workspace package (single shared
  // copy of core/runtime/tools at runtime) plus ink + react which
  // tsup cannot bundle because they have native/JSX runtime concerns.
  external: [/^@wrongstack\//, 'ink', 'react'],
});
