import * as fs from 'fs';
import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

function keepNodeProtocol(): Plugin {
  return {
    name: 'keep-node-protocol',
    setup(build) {
      const log = (msg: string) => fs.appendFileSync('C:/Users/ersin/plugin-log.txt', msg + '\n');
      log('plugin setup called');
      build.onResolve({ filter: /^node:/ }, (args) => {
        log('onResolve: ' + args.path + ' from ' + (args.importer || 'entry'));
        return { path: args.path, external: true };
      });
      build.onLoad({ filter: /.*/ }, (args) => {
        log('onLoad: ' + args.path);
        return undefined;
      });
    },
  };
}

export default defineConfig({
  platform: 'node',
  esbuildPlugins: [keepNodeProtocol()],
  entry: ['src/codebase-index/index.ts'],
  format: ['esm'],
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2023',
  external: ['@wrongstack/core'],
});