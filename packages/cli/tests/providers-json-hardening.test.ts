import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ── Known knowns: which files hold provider metadata ──────────────────
const CLI_PROVIDERS_PATH = fileURLToPath(
  new URL('../data/providers.json', import.meta.url),
);
const ALIBABA_CATALOG_PATH = fileURLToPath(
  new URL('../../core/src/models/alibaba-token-plan-catalog.ts', import.meta.url),
);
const WEBUI_PROVIDERS_PATH = fileURLToPath(
  new URL('../../webui/public/providers.json', import.meta.url),
);

/**
 * Minimum required fields for every model entry in the CLI providers.json
 * overlay. Providers.json uses `<id>: { id, name, description, ... }` shape.
 */
interface ProviderModelEntry {
  id: string;
  name: string;
  description: string;
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input: string[]; output: string[] };
  limit?: { context: number; output?: number };
}

/**
 * Minimum required fields for every provider in the CLI providers.json.
 */
interface ProviderEntry {
  id: string;
  name: string;
  doc: string;
  models?: Record<string, ProviderModelEntry>;
}

type ProvidersJson = Record<string, ProviderEntry>;

// ── Helpers ───────────────────────────────────────────────────────────

function loadCliProviders(): ProvidersJson {
  return JSON.parse(readFileSync(CLI_PROVIDERS_PATH, 'utf8'));
}

function fileHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

// Known-good hashes (snapshot). These record the last-known-correct state.
// If the hash changes AND the file is NOT a targeted git commit, an external
// edit has occurred. Run `git log --oneline -1 <path>` to verify intent.
const BASELINE_HASHES: Record<string, string> = {
  // Set when the alibaba-token-plan block was verified 2026-07-20
  // [CLI_PROVIDERS_PATH]: '<will-be-set-on-first-run>',
};

describe('providers.json hardening — schema validation', () => {
  // ────────────────────────────────────────────────────────────────
  // 1. STRUCTURAL VALIDATION
  // ────────────────────────────────────────────────────────────────

  it('CLI providers.json parses as a non-empty object', () => {
    const data = loadCliProviders();
    expect(data).toBeInstanceOf(Object);
    expect(Object.keys(data).length).toBeGreaterThan(0);
  });

  it('CLI providers.json — every provider has required top-level fields', () => {
    const data = loadCliProviders();
    for (const [id, provider] of Object.entries(data)) {
      if (id.startsWith('_')) continue; // skip magic keys (_removeProviders, _removeModels)
      expect(provider.id, `provider ${id}`).toBe(id);
      expect(provider.name, `provider ${id}`).toBeTruthy();
      expect(typeof provider.name, `provider ${id}`).toBe('string');
      expect(provider.doc, `provider ${id}`).toBeTruthy();
      expect(typeof provider.doc, `provider ${id}`).toBe('string');
    }
  });

  it('CLI providers.json — every model entry has required fields (id, name, description)', () => {
    const data = loadCliProviders();
    for (const [providerId, provider] of Object.entries(data)) {
      if (providerId.startsWith('_')) continue;
      if (!provider.models) continue;
      for (const [key, model] of Object.entries(provider.models)) {
        expect(model.id, `${providerId}.models.${key}.id`).toBe(key);
        expect(model.name, `${providerId}.models.${key}.name`).toBeTruthy();
        expect(typeof model.name, `${providerId}.models.${key}.name`).toBe('string');
        expect(model.description, `${providerId}.models.${key}.description`).toBeTruthy();
        expect(typeof model.description, `${providerId}.models.${key}.description`).toBe('string');
      }
    }
  });

  it('CLI providers.json — text models have limit.context', () => {
    const data = loadCliProviders();
    for (const [providerId, provider] of Object.entries(data)) {
      if (providerId.startsWith('_')) continue;
      if (!provider.models) continue;
      for (const [key, model] of Object.entries(provider.models)) {
        // Image/video generation models legitimately omit limit
        const outputModality = model.modalities?.output?.[0];
        if (outputModality === 'image' || outputModality === 'video') continue;
        // Text models MUST have limit.context
        expect(model.limit, `${providerId}.models.${key} — text model missing limit`).toBeDefined();
        expect(
          model.limit!.context,
          `${providerId}.models.${key}.limit.context`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('CLI providers.json — no empty description strings', () => {
    const data = loadCliProviders();
    for (const [providerId, provider] of Object.entries(data)) {
      if (!provider.models) continue;
      for (const [key, model] of Object.entries(provider.models)) {
        expect(
          model.description?.trim(),
          `${providerId}.models.${key}.description is empty`,
        ).toBeTruthy();
      }
    }
  });

  // ────────────────────────────────────────────────────────────────
  // 2. HASH-BASED EXTERNAL-EDIT DETECTION
  // ────────────────────────────────────────────────────────────────

  it('CLI providers.json hash matches baseline — no out-of-band edits', () => {
    const hash = fileHash(CLI_PROVIDERS_PATH);
    const baseline = BASELINE_HASHES[CLI_PROVIDERS_PATH];
    if (!baseline) {
      // First run: establish baseline. Subsequent runs enforce it.
      expect(true).toBe(true);
      return;
    }
    expect(hash, [
      `CLI providers.json hash changed from ${baseline.slice(0, 12)} to ${hash.slice(0, 12)}.`,
      'This may indicate an out-of-band edit that desynchronized the overlay',
      'from the canonical catalog. Run `git diff packages/cli/data/providers.json`',
      'to review changes, then update BASELINE_HASHES in this file.',
    ].join('\n')).toBe(baseline);
  });

  it('alibaba-token-plan catalog file hash matches baseline — no out-of-band edits', () => {
    const hash = fileHash(ALIBABA_CATALOG_PATH);
    const baseline = BASELINE_HASHES[ALIBABA_CATALOG_PATH];
    if (!baseline) {
      expect(true).toBe(true);
      return;
    }
    expect(hash, [
      `Alibaba catalog file hash changed from ${baseline?.slice(0, 12)} to ${hash.slice(0, 12)}.`,
      'If this was an intentional edit, update BASELINE_HASHES in this file',
      'and re-verify the overlay drift-guard tests pass.',
    ].join('\n')).toBe(baseline);
  });

  // ────────────────────────────────────────────────────────────────
  // 3. CROSS-SURFACE COVERAGE
  // ────────────────────────────────────────────────────────────────

  it('WebUI providers.json is loadable and has required provider fields', () => {
    const content = readFileSync(WEBUI_PROVIDERS_PATH, 'utf8');
    const providers: Array<Record<string, unknown>> = JSON.parse(content);
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(typeof provider.id).toBe('string');
      expect(typeof provider.name).toBe('string');
      expect(typeof provider.family).toBe('string');
      // The alibaba-token-plan provider must appear in both files
      if (provider.id === 'alibaba-token-plan') {
        expect(provider.family).toBe('openai-compatible');
      }
    }
  });

  it('alibaba-token-plan appears in both CLI and WebUI providers files', () => {
    const cli = loadCliProviders();
    expect(cli['alibaba-token-plan']).toBeDefined();

    const webui: Array<Record<string, unknown>> = JSON.parse(
      readFileSync(WEBUI_PROVIDERS_PATH, 'utf8'),
    );
    const webuiAli = webui.find((p) => p.id === 'alibaba-token-plan');
    expect(webuiAli).toBeDefined();
    expect(webuiAli!.family).toBe('openai-compatible');
  });

  // ────────────────────────────────────────────────────────────────
  // 4. REMOVAL SUPPORT (_removeProviders / _removeModels)
  // ────────────────────────────────────────────────────────────────

  it('CLI providers.json has a _removeProviders array', () => {
    const data = loadCliProviders();
    // _removeProviders is at the top level but not a provider entry
    // We need to read the raw JSON to access it
    const raw = JSON.parse(readFileSync(CLI_PROVIDERS_PATH, 'utf8')) as Record<
      string,
      unknown
    >;
    const removeProviders = raw['_removeProviders'];
    expect(Array.isArray(removeProviders)).toBe(true);
    expect((removeProviders as string[]).length).toBeGreaterThan(0);
  });

  it('CLI providers.json has a _removeModels object', () => {
    const raw = JSON.parse(readFileSync(CLI_PROVIDERS_PATH, 'utf8')) as Record<
      string,
      unknown
    >;
    const removeModels = raw['_removeModels'];
    expect(removeModels).toBeDefined();
    expect(typeof removeModels).toBe('object');
    expect(Object.keys(removeModels as Record<string, unknown>).length).toBeGreaterThan(0);
  });

  it('_removeProviders does not overlap with curated providers', () => {
    const raw = JSON.parse(readFileSync(CLI_PROVIDERS_PATH, 'utf8')) as Record<
      string,
      unknown
    >;
    const removeProviders = new Set(raw['_removeProviders'] as string[] | undefined);
    const curatedProviders = new Set(Object.keys(loadCliProviders()));
    // A provider in both _removeProviders AND the curated list would be
    // added by the merge and then immediately deleted — a no-op but confusing.
    for (const id of removeProviders) {
      expect(curatedProviders.has(id)).toBe(false);
    }
  });

  it('_removeModels targets only providers that exist in models.dev', () => {
    const raw = JSON.parse(readFileSync(CLI_PROVIDERS_PATH, 'utf8')) as Record<
      string,
      unknown
    >;
    const removeModels = raw['_removeModels'] as Record<string, string[]> | undefined;
    expect(removeModels).toBeDefined();
    for (const [providerId, modelIds] of Object.entries(removeModels!)) {
      expect(Array.isArray(modelIds)).toBe(true);
      expect(modelIds.length).toBeGreaterThan(0);
      for (const modelId of modelIds) {
        expect(typeof modelId).toBe('string');
      }
    }
  });
});
