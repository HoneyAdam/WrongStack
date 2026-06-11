// Heap-leak reproduction harness — drives the REAL dist bash tool's
// executeStream while `pnpm test` runs, emitting tool.progress on a real
// EventBus like ToolExecutor does, sampling heap every 5s.
// Run: node --expose-gc leak-harness.mjs
import { setTimeout as sleep } from 'node:timers/promises';

const core = await import('./packages/core/dist/index.js');
const tools = await import('./packages/tools/dist/index.js');

const { EventBus } = core;
const { bashTool } = tools;

const events = new EventBus();
let progressCount = 0;
let progressBytes = 0;
events.on('tool.progress', (e) => {
  progressCount++;
  if (e.event?.text) progressBytes += e.event.text.length;
});

const mb = (n) => Math.round(n / 1048576);
const snap = (label) => {
  if (global.gc) global.gc();
  const m = process.memoryUsage();
  console.log(
    `[${label}] heapUsed=${mb(m.heapUsed)}MB rss=${mb(m.rss)}MB ext=${mb(m.external)}MB ` +
      `progress=${progressCount}ev/${mb(progressBytes)}MBtext`,
  );
};

snap('boot');

const ac = new AbortController();
const ctx = {
  cwd: process.cwd(),
  projectRoot: process.cwd(),
  state: { appendMessage() {}, messages: [] },
  meta: {},
};
const opts = { signal: ac.signal };

const sampler = setInterval(() => {
  const m = process.memoryUsage();
  console.log(`  tick heapUsed=${mb(m.heapUsed)}MB rss=${mb(m.rss)}MB`);
}, 5000);
sampler.unref();

console.log('running pnpm test via bashTool.executeStream...');
const t0 = Date.now();
let final;
for await (const ev of bashTool.executeStream({ command: 'pnpm test 2>&1', timeout_ms: 300000 }, ctx, opts)) {
  if (ev.type === 'final') {
    final = ev.output;
    break;
  }
  events.emit('tool.progress', { name: 'bash', id: 'leak-1', event: ev });
}
console.log(
  `done in ${Math.round((Date.now() - t0) / 1000)}s, exit=${final?.exit_code}, outBytes=${final?.output?.length}`,
);

clearInterval(sampler);
snap('after-run');
await sleep(3000);
snap('after-3s');
