import * as os from 'node:os';
console.log('tmpdir:', os.tmpdir());
console.log('hasSpaces:', os.tmpdir().includes(' '));
console.log('homedir:', os.homedir());
