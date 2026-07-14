import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('@wrongstack/webui package bin', () => {
  it('no longer publishes a bin — the standalone server moved to @wrongstack/webui-server (PR-018b)', () => {
    const webuiPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/webui/package.json'), 'utf8'),
    ) as { bin?: Record<string, string> };

    // The HTTP/WebSocket server (and its `wstackui` executable) was extracted
    // to @wrongstack/webui-server, so the frontend-only @wrongstack/webui
    // package no longer ships an executable.
    expect(webuiPkg.bin).toBeUndefined();
  });

  it('the standalone executable is published as wstackui by @wrongstack/webui-server, not webui', () => {
    const serverPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/webui-server/package.json'), 'utf8'),
    ) as { bin?: Record<string, string> };

    expect(serverPkg.bin).toEqual({ wstackui: './dist/server/entry.js' });
    expect(serverPkg.bin).not.toHaveProperty('webui');
  });
});
