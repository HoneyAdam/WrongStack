/**
 * Backward-compatible re-export. All functionality has moved to
 * `auth-menu/index.ts` and its submodules. This file exists so
 * existing imports don't break during the transition.
 */
export { type AuthMenuDeps, runAuthDirect, runAuthMenu } from './auth-menu/index.js';
