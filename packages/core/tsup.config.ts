import { defineConfig } from 'tsup';

const skipDts = process.env.WRONGSTACK_SKIP_DTS === '1';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/kernel/index.ts',
    'src/types/index.ts',
    'src/defaults/index.ts',
    'src/utils/index.ts',
    'src/utils/expect-defined.ts',
    'src/utils/error.ts',
    'src/execution/prompt-enhancer.ts',
    // Domain entry points (new as of 0.2.0)
    'src/execution/index.ts',
    'src/coordination/index.ts',
    'src/storage/index.ts',
    'src/security/index.ts',
    'src/models/index.ts',
    'src/infrastructure/index.ts',
    'src/observability/index.ts',
    'src/tools/index.ts',
    'src/extension/index.ts',
    // HQ command center protocol + publisher
    'src/hq/index.ts',
    // Skill installer
    'src/skills/index.ts',
  ],
  format: ['esm'],
  dts: skipDts ? false : true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2023',
});
