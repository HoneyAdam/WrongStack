import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectPopularProviderCatalog } from '../src/provider-definitions.js';

const WEBUI_CATALOG_PATH = fileURLToPath(
  new URL('../../webui/public/providers.json', import.meta.url),
);

describe('generated provider catalog', () => {
  it('matches the canonical ProviderDefinition projection', () => {
    const snapshot = JSON.parse(readFileSync(WEBUI_CATALOG_PATH, 'utf8'));
    expect(snapshot).toEqual(projectPopularProviderCatalog());
  });
});
