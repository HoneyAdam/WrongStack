const fs = require('fs');
const c = fs.readFileSync('D:/Codebox/PROJECTS/WrongStack/packages/tui/src/app.tsx','utf8');
const lines = c.split('\n');
lines.forEach((l,i) => {
  if (/TuiMouseEvent|mouseLive|mouseLiveRef|setMouseLive|setManagedLive|subscribeMouse|mouse[/,]/.test(l)) {
    console.log(`${i+1}: ${l.trim().substring(0,150)}`);
  }
});
