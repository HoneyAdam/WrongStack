// Re-export of @wrongstack/core's TaskTracker for sdd's internal test
// suite and consumers. The core package owns the implementation; this
// file only exists so tests under packages/sdd/tests/ can do
// `import { TaskTracker } from '../src/task-tracker.js'` (vitest loads
// TypeScript source directly without going through the exports field).
//
// If a consumer outside sdd wants TaskTracker, import it from
// '@wrongstack/core/tasking/task-tracker.js' or just from
// '@wrongstack/core' (the latter is re-exported as of the regression
// fix that motivated this file's existence).
export {
  type TaskStore,
  type TaskTrackerOptions,
  type TaskTransition,
  type TaskTrackerChange,
  type TaskTrackerListener,
  TaskTracker,
} from '@wrongstack/core/tasking/task-tracker.js';
