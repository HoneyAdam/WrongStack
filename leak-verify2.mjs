const core = await import('./packages/core/dist/index.js');
const tools = await import('./packages/tools/dist/index.js');
const { ToolExecutor, EventBus } = core;
const { bashTool } = tools;
const events = new EventBus();
const registry = { get: (name) => (name === 'bash' ? bashTool : undefined), list: () => [bashTool] };
const executor = new ToolExecutor(registry, {
  permissionPolicy: { evaluate: async () => ({ decision: 'allow' }) },
  secretScrubber: { scrub: (s) => s, scrubObject: (o) => o },
  events,
});
const ctx = { cwd: process.cwd(), projectRoot: process.cwd(), state: { appendMessage() {}, messages: [] }, meta: {}, signal: new AbortController().signal };
const res = await executor.executeBatch(
  [{ type: 'tool_use', id: 'v1', name: 'bash', input: { command: 'echo hi', timeout_ms: 30000 } }],
  ctx, 'sequential',
);
console.log(JSON.stringify(res.outputs?.[0]?.result, null, 1).slice(0, 800));
