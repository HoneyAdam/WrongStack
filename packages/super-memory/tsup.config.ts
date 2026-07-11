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
  external: ['@wrongstack/core', '@wrongstack/core/utils'],
});
