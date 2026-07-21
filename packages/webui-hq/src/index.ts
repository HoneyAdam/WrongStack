/**
 * @wrongstack/webui-hq — HQ Command Center dashboard.
 *
 * Offline React app served by the HQ server (port 3499). No CDN dependencies.
 * Build with `vite build` → `dist/`. The HQ server serves `dist/index.html`
 * at `/` and shows a diagnostic-only recovery document when assets are missing.
 */
export { HqApp } from './app.js';
export { getHqClient, HqWsClient } from './lib/hq-ws-client.js';
