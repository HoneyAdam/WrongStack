/**
 * Inspect event types in a session JSONL file.
 */
import { createReadStream } from 'node:fs';

const sessionPath = process.argv[2];
if (!sessionPath) {
  console.error('Usage: node scripts/inspect-session-types.mjs <session-jsonl-path>');
  process.exit(1);
}

const typeCount = {};
let total = 0;

const stream = createReadStream(sessionPath, { encoding: 'utf8' });
let buffer = '';

for await (const chunk of stream) {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      total++;
      const type = event.type ?? event.event ?? 'unknown';
      typeCount[type] = (typeCount[type] || 0) + 1;
    } catch {
      // skip
    }
  }
}

console.error(`Total events: ${total}\n`);
console.log('Event type distribution:');
for (const [type, count] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count}`);
}
