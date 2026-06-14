const fs = require('fs');
const path = process.argv[2];
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

let shown = 0;
for (const raw of lines) {
  const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!line) continue;
  try {
    const ev = JSON.parse(line);
    if (!ev.event || ev.event !== 'compaction.elision.full_pass.ended') continue;
    console.log(JSON.stringify({
      messageCount: ev.messageCount,
      preserveStart: ev.preserveStart,
      fullPassIterations: ev.fullPassIterations,
      fullPassInnerIterations: ev.fullPassInnerIterations,
      fullPassInnerPerOuter: ev.fullPassInnerPerOuter,
      tokensSaved: ev.tokensSaved,
      changed: ev.changed,
    }));
    if (++shown >= 10) break;
  } catch {}
}
