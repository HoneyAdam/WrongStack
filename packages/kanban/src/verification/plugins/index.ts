/**
 * Register all built-in deterministic verifier plugins.
 * Escalation plugins (agent, council) are registered separately
 * to keep the default path LLM-free.
 */
import { VerifierRegistry } from '../verifier-registry.js';
import { FileExistsPlugin } from './file-exists.js';
import { FileMatchesPlugin } from './file-matches.js';
import { CommandPlugin } from './command.js';
import { TestPlugin } from './test.js';
import { GitDiffPlugin } from './git-diff.js';
import { MetricPlugin } from './metric.js';

/**
 * Create a VerifierRegistry pre-loaded with all deterministic plugins.
 * This is the default registry used when no escalation is configured.
 */
export function createDefaultRegistry(): VerifierRegistry {
  return new VerifierRegistry()
    .register(new FileExistsPlugin())
    .register(new FileMatchesPlugin())
    .register(new CommandPlugin())
    .register(new TestPlugin())
    .register(new GitDiffPlugin())
    .register(new MetricPlugin());
}
