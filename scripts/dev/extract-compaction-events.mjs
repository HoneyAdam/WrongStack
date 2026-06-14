/**
 * Extracts and reports compaction metrics from a session JSONL file.
 * Usage: node scripts/extract-compaction-events.mjs <session-jsonl-path>
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const sessionPath = process.argv[2];
if (!sessionPath) {
  console.error('Usage: node scripts/extract-compaction-events.mjs <session-jsonl-path>');
  process.exit(1);
}

const stats = await stat(sessionPath);
console.error(`Reading ${stats.size} bytes from ${sessionPath}...`);

const events = [];
let eventCount = 0;

try {
  const stream = createReadStream(sessionPath, { encoding: 'utf8' });
  let buffer = '';

  for await (const chunk of stream) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        eventCount++;
        if (event.event?.startsWith('compaction.')) {
          events.push(event);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  // process remaining buffer
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer);
      eventCount++;
      if (event.event?.startsWith('compaction.')) {
        events.push(event);
      }
    } catch {
      // skip
    }
  }
} catch (err) {
  console.error(`Error reading file: ${err.message}`);
  process.exit(1);
}

console.error(`Total events: ${eventCount}, Compaction events: ${events.length}\n`);

if (events.length === 0) {
  console.log('No compaction events found in this session.');
  process.exit(0);
}

// Summary by event type
const byType = {};
for (const e of events) {
  const type = e.event;
  if (!byType[type]) byType[type] = [];
  byType[type].push(e);
}

for (const [type, evts] of Object.entries(byType)) {
  console.log(`\n## ${type} (${evts.length} occurrences)`);
  for (const e of evts) {
    const ratio = e.fullPassInnerIterations > 0
      ? (e.fullPassInnerIterations / e.fullPassIterations).toFixed(3)
      : 'N/A';
    const fastRatio = e.fastPathInnerIterations > 0
      ? (e.fastPathInnerIterations / e.fastPathIterations).toFixed(3)
      : 'N/A';
    console.log(
      `  msgs=${e.messageCount} ` +
      `preserveStart=${e.preserveStart} ` +
      `fastPathIters=${e.fastPathIterations}/${e.fastPathInnerIterations} (${fastRatio}) ` +
      `fullPassIters=${e.fullPassIterations}/${e.fullPassInnerIterations} (${ratio}) ` +
      `saved=${e.tokensSaved ?? 0}tokens ` +
      `changed=${e.changed}`
    );
  }
}
