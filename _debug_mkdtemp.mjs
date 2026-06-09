import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

(async () => {
  try {
    const tmpdir = os.tmpdir();
    console.log('tmpdir:', tmpdir);
    const prefix = path.join(tmpdir, 'wstest-XXXXXX');
    console.log('prefix:', prefix);
    const d = await fs.mkdtemp(prefix);
    console.log('OK:', d);
    await fs.rmdir(d);
  } catch (e) {
    console.error('FAIL:', e.message);
    console.error('stack:', e.stack?.split('\n').slice(0, 3).join('\n'));
  }
})();
