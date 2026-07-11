/**
 * Typed boundary between CLI wiring and the execution phase.
 *
 * `cli-main` deliberately constructs the already-grouped ExecuteDeps shape:
 * keeping that shape visible at the composition root makes missing subsystem
 * dependencies obvious. This helper gives the assembly a separately testable
 * boundary without the previous mutable 80-field WireContext or unsafe casts.
 */
import type { ExecuteDeps } from '../execute-deps.js';

export function toExecuteDeps(deps: ExecuteDeps): ExecuteDeps {
  return deps;
}
