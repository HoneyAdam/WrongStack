const fs = require('fs');
const path = 'D:/Codebox/PROJECTS/WrongStack/packages/webui/src/components/AgentFlowGraph';
try {
  fs.rmSync(path, { recursive: true, force: true });
  console.log('Removed:', path);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
