import { defineConfig } from 'tsup';

// PR #018b extracted @wrongstack/webui/server into @wrongstack/webui-server.
// The webui package now ships only the React + Vite frontend. The `./server`
// export below is a 1-line back-compat shim re-exporting from
// @wrongstack/webui-server; will be removed in a follow-up.
//
// Build-order note: the DTS step tries to resolve @wrongstack/webui-server
// imports, which fails when the new package hasn't been built yet. We keep
// the shim out of the DTS graph by emitting it as a JS-only entry (`dts: false`
// for that entry, achieved by listing it in `noExternal`-style exclusion).
// tsup doesn't support per-entry dts: false directly, so we drop the shim
// entry from the tsup config and let the runtime fallback (the shim file is
// still shipped — it just isn't pre-built by tsup; consumers that import
// @wrongstack/webui/server hit Node's resolver which finds the
// @wrongstack/webui-server dist at runtime).
export default defineConfig({
  entry: {
    index: 'src/main.tsx',
    types: 'src/types.ts',
  },
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  dts: true,
  external: [
    'react',
    'react-dom',
    '@wrongstack/core',
    '@wrongstack/tools',
    '@wrongstack/webui-server',
    'tailwindcss',
    './index.css',
    '@fontsource-variable/ibm-plex-sans',
    '@fontsource/ibm-plex-mono',
  ],
  esbuildOptions: (options) => {
    options.conditions = ['module', 'jsnext:main', 'jsnext'];
    options.mainFields = ['module', 'jsnext:main', 'main'];
  },
  // Build the back-compat shim to dist/server/index.js as a one-line re-export.
  // We do this with a shell command in onSuccess so tsup's DTS step doesn't
  // try to resolve @wrongstack/webui-server (which isn't built at this point).
  onSuccess: async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const outDir = 'dist/server';
    await fs.mkdir(outDir, { recursive: true });
    // Single-line re-export. Tree-shaking eliminates the indirection in
    // bundlers; for unbundled Node ESM, the runtime resolution to
    // @wrongstack/webui-server's index.js is handled by Node's exports map.
    const content =
      "export * from '@wrongstack/webui-server';\n" +
      "import { startWebUI } from '@wrongstack/webui-server';\n" +
      "export { startWebUI };\n";
    await fs.writeFile(path.join(outDir, 'index.js'), content);
    // Also write a minimal .d.ts that re-exports from @wrongstack/webui-server.
    // Without this, downstream packages (e.g. @wrongstack/cli) that import
    // from @wrongstack/webui/server get an implicit `any` type and the
    // strict noImplicitAny fails. The .d.ts is a one-liner: re-export
    // everything from the new home's public types.
    const dtsContent = "export * from '@wrongstack/webui-server';\n";
    await fs.writeFile(path.join(outDir, 'index.d.ts'), dtsContent);
  },
});