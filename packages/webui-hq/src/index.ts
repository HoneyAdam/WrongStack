/**
 * @wrongstack/webui-hq — HQ Command Center dashboard.
 *
 * Offline React app served by the HQ server (port 3499). No CDN dependencies.
 * Build with `vite build` → `dist/`. The HQ server serves `dist/index.html`
 * at `/` with graceful fallback to the inline HTML when unbuilt.
 */
export { HqApp } from './app.js';
export { getHqClient, HqWsClient } from './lib/hq-ws-client.js';
