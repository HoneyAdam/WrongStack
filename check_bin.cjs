// Find actual vitest executable
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const bin = path.join(__dirname, 'node_modules', '.bin', 'vitest');
const stats = fs.statSync(bin);
console.log('bin exists:', stats.isFile());
console.log('bin size:', stats.size);

// Read first 100 bytes
const fd = fs.openSync(bin, 'r');
const buf = Buffer.alloc(100);
fs.readSync(fd, buf, 0, 100, 0);
fs.closeSync(fd);
console.log(buf.toString('utf8', 0, 100));