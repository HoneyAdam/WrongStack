const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/analyze-compaction-metrics.cjs <file>'); process.exit(1); }
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

const mc = {};
const eventTypes = {};
let total = 0;

for (const raw of lines) {
  const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!line) continue;
  try {
    const ev = JSON.parse(line);
    if (!ev.event || !ev.event.startsWith('compaction.')) continue;
    total++;
    const msgKey = String(ev.messageCount ?? '?');
    mc[msgKey] = (mc[msgKey] || 0) + 1;
    eventTypes[ev.event] = (eventTypes[ev.event] || 0) + 1;
  } catch {}
}

console.log('Compaction event types:');
for (const [k, v] of Object.entries(eventTypes).sort((a, b) => b[1] - a[1])) {
  console.log(' ', k, ':', v);
}
console.log('\nmessageCount distribution:');
for (const [k, v] of Object.entries(mc).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log('  messageCount', k, ':', v, 'events');
}
console.log('\nTotal compaction events:', total);
