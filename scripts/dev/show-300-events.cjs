const fs = require('node:fs');
const path = process.argv[2];
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

let shown = 0;
for (const raw of lines) {
  const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!line) continue;
  try {
    const ev = JSON.parse(line);
    if (!ev.event || !ev.event.startsWith('compaction.')) continue;
    if (ev.messageCount !== 300) continue;
    console.log(JSON.stringify(ev));
    if (++shown >= 3) break;
  } catch {}
}
