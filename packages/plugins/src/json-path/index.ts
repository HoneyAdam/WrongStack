/**
 * json-path plugin — RETIRED.
 *
 * The four tools this plugin previously registered (`jmespath_query`,
 * `json_validate`, `json_transform`, `json_merge`) have been consolidated
 * into the built-in `json` tool (packages/tools/src/json.ts) via its
 * `action` parameter.
 *
 * This file remains as a no-op stub so existing config references
 * (`"json-path": { "enabled": true }`) do not break. It registers no
 * tools and logs a deprecation notice on load.
 */
import type { Plugin } from '@wrongstack/core';

const API_VERSION = '^0.1.10';

const plugin: Plugin = {
  name: 'json-path',
  version: '0.2.0',
  description: 'Retired — capabilities merged into the built-in json tool',
  apiVersion: API_VERSION,
  capabilities: { tools: true },
  setup(api) {
    api.log.info('json-path plugin retired — use the built-in json tool with action: query|validate|transform|merge');
  },
};

export default plugin;
