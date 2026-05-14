// Server entry point for standalone WebUI.
// Bind defaults: 127.0.0.1:3457 (loopback only). Override with WS_HOST / WS_PORT.
import { startWebUI } from './index.js';

const wsPort = Number.parseInt(process.env['WS_PORT'] ?? '3457', 10);
const wsHost = process.env['WS_HOST'] ?? '127.0.0.1';

console.log(`[WebUI] Starting standalone server on ${wsHost}:${wsPort}...`);

startWebUI({ wsPort, wsHost }).catch((err) => {
  console.error('[WebUI] Fatal error:', err);
  process.exit(1);
});
