// Re-export of @wrongstack/core's TaskTracker for sdd's internal test
// suite and consumers. The core package owns the implementation; this
// file only exists so tests under packages/sdd/tests/ can do
// `import { TaskTracker } from '../src/task-tracker.js'` (vitest loads
// TypeScript source directly without going through the exports field).
//
// If a consumer outside sdd wants TaskTracker, import it from
// '@wrongstack/core' — the root re-exports TaskTracker + all its
// types. The deeper subpath `@wrongstack/core/tasking/task-tracker.js`
// does NOT work because @wrongstack/core's package.json `exports`
// field only declares the whole `./tasking` subpath, not individual
// files under it (Node 16+ refuses to fall back to the dist tree
// when an undeclared subpath is requested).
export {
  type TaskStore,
  type TaskTrackerOptions,
  type TaskTransition,
  type TaskTrackerChange,
  type TaskTrackerListener,
  TaskTracker,
} from '@wrongstack/core';
