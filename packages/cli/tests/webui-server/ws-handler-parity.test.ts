import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WS-handler parity guard.
 *
 * There are two WebUI servers that drive the same browser client over the same
 * `WSClientMessage` protocol:
 *   - CLI-embedded  (`wrongstack --webui`) — packages/cli/src/webui-server.ts
 *   - standalone    (`wrongstack webui`)   — packages/webui/src/server/index.ts
 *
 * Historically they drifted: a message type handled by one but not the other
 * silently breaks that surface (e.g. the embedded server once punted ALL
 * `mcp.*` writes). This test extracts the `case '<type>'` labels from each
 * server's single `switch (msg.type)` and asserts the two sets are identical,
 * so any future handler added to one server but not the other fails CI loudly.
 *
 * `autophase.*` and `collab.*` are intentionally NOT in these switches — both
 * servers route them to dedicated handlers (`AutoPhaseWebSocketHandler` /
 * `CollaborationWebSocketHandler`) via a `msg.type.startsWith(...)` check before
 * the switch, so their absence here is correct and symmetric.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const embeddedPath = path.join(repoRoot, 'packages/cli/src/webui-server.ts');
const standalonePath = path.join(repoRoot, 'packages/webui/src/server/index.ts');

/** Extract the set of `case '<label>'` labels from a source file. */
function caseLabels(file: string): Set<string> {
  const src = fs.readFileSync(file, 'utf8');
  const labels = new Set<string>();
  for (const m of src.matchAll(/case\s+'([^']+)'\s*:/g)) {
    labels.add(m[1] as string);
  }
  return labels;
}

describe('WebUI WS-handler parity (embedded vs standalone)', () => {
  it('both server files exist and have message-type cases', () => {
    expect(fs.existsSync(embeddedPath)).toBe(true);
    expect(fs.existsSync(standalonePath)).toBe(true);
    expect(caseLabels(embeddedPath).size).toBeGreaterThan(50);
    expect(caseLabels(standalonePath).size).toBeGreaterThan(50);
  });

  it('handles an identical set of WS message types in both servers', () => {
    const embedded = caseLabels(embeddedPath);
    const standalone = caseLabels(standalonePath);

    const onlyEmbedded = [...embedded].filter((t) => !standalone.has(t)).sort();
    const onlyStandalone = [...standalone].filter((t) => !embedded.has(t)).sort();

    // If this fails, a message handler was added to one server but not the
    // other. Add the matching `case` to the other server (or, for messages
    // routed by a dedicated startsWith handler, ensure both route it).
    expect({ onlyEmbedded, onlyStandalone }).toEqual({
      onlyEmbedded: [],
      onlyStandalone: [],
    });
  });
});
