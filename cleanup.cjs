const fs = require('fs');
try {
  fs.unlinkSync('rm-test.cjs');
} catch(e) {}
process.exit(0);