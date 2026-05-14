const fs = require('node:fs');
const paths = [
  'D:/Codebox/PROJECTS/WrongStack/packages/webui/src/server',
  'D:/Codebox/PROJECTS/WrongStack/packages/webui/src/lib/websocket.ts',
  'D:/Codebox/PROJECTS/WrongStack/packages/webui/src/components/SendButton.tsx',
];
for (const p of paths) {
  try {
    if (fs.statSync(p).isDirectory()) {
      fs.rmSync(p, { recursive: true });
      console.log('Removed dir:', p);
    } else {
      fs.unlinkSync(p);
      console.log('Removed file:', p);
    }
  } catch (e) {
    console.log('Error:', p, e.message);
  }
}
