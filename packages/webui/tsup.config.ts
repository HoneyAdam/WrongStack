import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/main.tsx',
    'server/entry': 'src/server/entry.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  dts: true,
  external: ['react', 'react-dom'],
  esbuildOptions: (options) => {
    options.conditions = ['module', 'jsnext:main', 'jsnext'];
    options.mainFields = ['module', 'jsnext:main', 'main'];
  },
});