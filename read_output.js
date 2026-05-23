const fs = require('fs');
const content = fs.readFileSync('test_output.txt', 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);
console.log('Total chars:', content.length);
// Print last 30 lines
for (let i = Math.max(0, lines.length - 30); i < lines.length; i++) {
  console.log(i + ': ' + lines[i]);
}