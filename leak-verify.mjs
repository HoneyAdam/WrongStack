// Post-fix verification: pnpm test through the REAL ToolExecutor (rebuilt dist).
const core = await import('./packages/core/dist/index.js');
const tools = await import('./packages/tools/dist/index.js');
const { ToolExecutor, EventBus } = core;
const { bashTool } = tools;

const events = new EventBus();
let n = 0, bytes = 0;
events.on('tool.progress', (e) => { n++; if (e.event?.text) bytes += e.event.text.length; });

const registry = { get: (name) => (name === 'bash' ? bashTool : undefined), list: () => [bashTool] };
const executor = new ToolExecutor(registry, {
  permissionPolicy: { evaluate: async () => ({ decision: 'allow' }) },
  secretScrubber: { scrub: (s) => s, scrubObject: (o) => o },
  events,
});
const ctx = {
  cwd: process.cwd(), projectRoot: process.cwd(),
  state: { appendMessage() {}, messages: [] }, meta: {},
};
const mb = (x) => (x / 1048576).toFixed(1);
const t0 = Date.now();
const res = await executor.executeBatch(
  [{ type: 'tool_use', id: 'verify-1', name: 'bash', input: { command: 'pnpm test 2>&1', timeout_ms: 300000 } }],
  ctx, 'sequential',
);
const m = process.memoryUsage();
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s — progress events=${n}, streamed=${mb(bytes)}MB, heapUsed=${mb(m.heapUsed)}MB`);
console.log('result is_error:', res.outputs?.[0]?.result?.is_error);
