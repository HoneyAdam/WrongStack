/**
 * Plugin catalog — single source of truth for plugin names and their
 * canonical source paths. Used by `spec-linker` to detect unlinked
 * plugin references in markdown files.
 *
 * The catalog is built at module load time by importing each plugin
 * source and reading its `name` field. This means the catalog is
 * always in sync with the actual plugins — adding a new plugin
 * (exporting it from `./index.ts` AND adding a row to the table
 * below) is enough for `spec-linker` to start detecting references
 * to it.
 *
 * To add a new plugin: see the table in `catalog.ts`. The `name`
 * must match the plugin's `name` field; the `path` is the
 * relative source directory under `packages/plugins/src/`.
 *
 * @public
 */
import type { Plugin } from '@wrongstack/core';

import agentHandoff from './agent-handoff/index.js';
import autoDoc from './auto-doc/index.js';
import autoEscalate from './auto-escalate/index.js';
import branchGuard from './branch-guard/index.js';
import changelogWriter from './changelog-writer/index.js';
import checkpoint from './checkpoint/index.js';
import commitValidator from './commit-validator/index.js';
import configValidator from './config-validator/index.js';
import contextPins from './context-pins/index.js';
import costTracker from './cost-tracker/index.js';
import cron from './cron/index.js';
import depGuard from './dep-guard/index.js';
import diffSummary from './diff-summary/index.js';
import errorLens from './error-lens/index.js';
import fileWatcher from './file-watcher/index.js';
import formatOnSave from './format-on-save/index.js';
import gitAutocommit from './git-autocommit/index.js';
import importOrganizer from './import-organizer/index.js';
import injectionShield from './injection-shield/index.js';
import knowledgeGraph from './knowledge-graph/index.js';
import lintGate from './lint-gate/index.js';
import llmCache from './llm-cache/index.js';
import loopBreaker from './loop-breaker/index.js';
import modelRouter from './model-router/index.js';
import notifyHub from './notify-hub/index.js';
import pathGuard from './path-guard/index.js';
import processGuard from './process-guard/index.js';
import pluginStackObserver from './plugin-stack-observer/index.js';
import prDrafter from './pr-drafter/index.js';
import promptFirewall from './prompt-firewall/index.js';
import secretScanner from './secret-scanner/index.js';
import semverBump from './semver-bump/index.js';
import sessionRecap from './session-recap/index.js';
import shellCheck from './shell-check/index.js';
import templateEngine from './template-engine/index.js';
import testCoverageGate from './test-coverage-gate/index.js';
import testRunnerGate from './test-runner-gate/index.js';
import typeGate from './type-gate/index.js';
import todoListener from './todo-listener/index.js';
import todoTracker from './todo-tracker/index.js';
import tokenBudget from './token-budget/index.js';
import tokenThrottle from './token-throttle/index.js';

// New plugins added in 2026-07 batch
import accessibilityAuditor from './accessibility-auditor/index.js';
import apiCompatibilityGate from './api-compatibility-gate/index.js';
import autoI18nExtractor from './auto-i18n-extractor/index.js';
import codeMetrics from './code-metrics/index.js';
import deadCodeDetector from './dead-code-detector/index.js';
import dependencyVulnerabilityGate from './dependency-vulnerability-gate/index.js';
import docSyncGuard from './doc-sync-guard/index.js';
import duplicateCodeDetector from './duplicate-code-detector/index.js';
import featureFlagTracker from './feature-flag-tracker/index.js';
import interfaceContractGuard from './interface-contract-guard/index.js';
import licenseAuditGate from './license-audit-gate/index.js';
import migrationPlanner from './migration-planner/index.js';
import performanceRegressionGate from './performance-regression-gate/index.js';
import refactorSuggester from './refactor-suggester/index.js';
import releaseNotesGenerator from './release-notes-generator/index.js';
import schemaEvolutionGuard from './schema-evolution-guard/index.js';
import securityHotspotScanner from './security-hotspot-scanner/index.js';
import semanticSearchIndexer from './semantic-search-indexer/index.js';
import smartRename from './smart-rename/index.js';
import testFlakeDetector from './test-flake-detector/index.js';
import testGenerator from './test-generator/index.js';

// NOTE: `spec-linker` is NOT imported here to avoid a circular
// dependency (spec-linker imports `catalog.ts` to read its own
// catalog entry). `spec-linker` self-registers in its source file.

interface CatalogEntry {
  /** The plugin's `name` field. */
  name: string;
  /** Relative path under `packages/plugins/src/`, e.g. `./src/auto-doc`. */
  path: string;
}

const ENTRIES: CatalogEntry[] = [
  { name: agentHandoff.name, path: './src/agent-handoff' },
  { name: autoDoc.name, path: './src/auto-doc' },
  { name: gitAutocommit.name, path: './src/git-autocommit' },
  { name: shellCheck.name, path: './src/shell-check' },
  { name: costTracker.name, path: './src/cost-tracker' },
  { name: fileWatcher.name, path: './src/file-watcher' },
  { name: cron.name, path: './src/cron' },
  { name: templateEngine.name, path: './src/template-engine' },
  { name: semverBump.name, path: './src/semver-bump' },
  { name: secretScanner.name, path: './src/secret-scanner' },
  { name: todoTracker.name, path: './src/todo-tracker' },
  { name: tokenBudget.name, path: './src/token-budget' },
  { name: lintGate.name, path: './src/lint-gate' },
  { name: branchGuard.name, path: './src/branch-guard' },
  { name: diffSummary.name, path: './src/diff-summary' },
  { name: commitValidator.name, path: './src/commit-validator' },
  { name: formatOnSave.name, path: './src/format-on-save' },
  { name: testRunnerGate.name, path: './src/test-runner-gate' },
  { name: importOrganizer.name, path: './src/import-organizer' },
  { name: todoListener.name, path: './src/todo-listener' },
  { name: sessionRecap.name, path: './src/session-recap' },
  { name: 'spec-linker', path: './src/spec-linker' },
  { name: loopBreaker.name, path: './src/loop-breaker' },
  { name: pathGuard.name, path: './src/path-guard' },
  { name: processGuard.name, path: './src/process-guard' },
  { name: contextPins.name, path: './src/context-pins' },
  { name: checkpoint.name, path: './src/checkpoint' },
  { name: errorLens.name, path: './src/error-lens' },
  { name: depGuard.name, path: './src/dep-guard' },
  { name: configValidator.name, path: './src/config-validator' },
  { name: notifyHub.name, path: './src/notify-hub' },
  { name: changelogWriter.name, path: './src/changelog-writer' },
  { name: injectionShield.name, path: './src/injection-shield' },
  { name: llmCache.name, path: './src/llm-cache' },
  { name: modelRouter.name, path: './src/model-router' },
  { name: promptFirewall.name, path: './src/prompt-firewall' },
  { name: autoEscalate.name, path: './src/auto-escalate' },
  { name: tokenThrottle.name, path: './src/token-throttle' },
  { name: pluginStackObserver.name, path: './src/plugin-stack-observer' },
  { name: knowledgeGraph.name, path: './src/knowledge-graph' },
  { name: prDrafter.name, path: './src/pr-drafter' },
  { name: testCoverageGate.name, path: './src/test-coverage-gate' },
  { name: typeGate.name, path: './src/type-gate' },
  { name: accessibilityAuditor.name, path: './src/accessibility-auditor' },
  { name: apiCompatibilityGate.name, path: './src/api-compatibility-gate' },
  { name: autoI18nExtractor.name, path: './src/auto-i18n-extractor' },
  { name: codeMetrics.name, path: './src/code-metrics' },
  { name: deadCodeDetector.name, path: './src/dead-code-detector' },
  { name: dependencyVulnerabilityGate.name, path: './src/dependency-vulnerability-gate' },
  { name: docSyncGuard.name, path: './src/doc-sync-guard' },
  { name: duplicateCodeDetector.name, path: './src/duplicate-code-detector' },
  { name: featureFlagTracker.name, path: './src/feature-flag-tracker' },
  { name: interfaceContractGuard.name, path: './src/interface-contract-guard' },
  { name: licenseAuditGate.name, path: './src/license-audit-gate' },
  { name: migrationPlanner.name, path: './src/migration-planner' },
  { name: performanceRegressionGate.name, path: './src/performance-regression-gate' },
  { name: refactorSuggester.name, path: './src/refactor-suggester' },
  { name: releaseNotesGenerator.name, path: './src/release-notes-generator' },
  { name: schemaEvolutionGuard.name, path: './src/schema-evolution-guard' },
  { name: securityHotspotScanner.name, path: './src/security-hotspot-scanner' },
  { name: semanticSearchIndexer.name, path: './src/semantic-search-indexer' },
  { name: smartRename.name, path: './src/smart-rename' },
  { name: testFlakeDetector.name, path: './src/test-flake-detector' },
  { name: testGenerator.name, path: './src/test-generator' },
];

/**
 * Sanity check at module load: every plugin `name` must be a
 * non-empty kebab-case string. Catches accidental misconfigurations
 * at import time instead of in the first hook invocation.
 */
function assertValidCatalog(entries: CatalogEntry[]): void {
  for (const e of entries) {
    if (typeof e.name !== 'string' || e.name.length === 0) {
      throw new Error(`plugin catalog: entry has invalid name: ${JSON.stringify(e)}`);
    }
    if (!/^[a-z0-9-]+$/.test(e.name)) {
      throw new Error(`plugin catalog: name "${e.name}" is not kebab-case`);
    }
  }
  // Reject duplicates — they would make findUnlinkedReferences
  // non-deterministic.
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) {
      throw new Error(`plugin catalog: duplicate entry for "${e.name}"`);
    }
    seen.add(e.name);
  }
}

assertValidCatalog(ENTRIES);

/**
 * Read-only view of the catalog as a Map from plugin name to its
 * source path. Frozen so consumers cannot mutate it.
 */
export const PLUGIN_CATALOG: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const e of ENTRIES) m.set(e.name, e.path);
  return m;
})();

/**
 * The list of catalog entries, ordered by the table above. Used by
 * `spec-linker` to iterate names in a stable order for detection.
 */
export const PLUGIN_CATALOG_ENTRIES: readonly CatalogEntry[] = Object.freeze(
  ENTRIES.map((e) => Object.freeze({ ...e })),
);

/** Convenience accessor: just the names, in declaration order. */
export const PLUGIN_NAMES: readonly string[] = PLUGIN_CATALOG_ENTRIES.map((e) => e.name);

// Re-export the Plugin type so consumers that only need the catalog
// type don't have to import from @wrongstack/core separately.
export type { Plugin };
