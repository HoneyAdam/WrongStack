/**
 * web-search plugin — RETIRED.
 *
 * Both tools this plugin previously registered have been consolidated:
 * - `web_search` → built-in `search` tool (packages/tools/src/search.ts)
 *   with native caching, dedup, ranking, and multiple search engines.
 * - `web_fetch` → built-in `fetch` tool (packages/tools/src/fetch.ts)
 *   which is strictly superior (DNS-pinned SSRF, TurndownService markdown,
 *   streaming, binary-content rejection, structured errors).
 *
 * This file remains as a no-op stub so existing config references
 * (`"web-search": { "enabled": true }`) do not break.
 */
import type { Plugin } from '@wrongstack/core';

const API_VERSION = '^0.1.10';

const plugin: Plugin = {
  name: 'web-search',
  version: '0.3.0',
  description: 'Retired — capabilities merged into built-in search and fetch tools',
  apiVersion: API_VERSION,
  capabilities: { tools: true },
  setup(api) {
    api.log.info('web-search plugin retired — use the built-in search and fetch tools');
  },
};

export default plugin;
