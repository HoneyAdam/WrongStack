import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { handleContentRoute } from '../src/server/content-routes.js';
import type { WSServerMessage } from '../src/server/types.js';

describe('canonical content handler family', () => {
  it('routes the read-only skills projection through the shared handler', async () => {
    const sent: WSServerMessage[] = [];
    const ws = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw) as WSServerMessage),
    } as unknown as WebSocket;
    const handled = await handleContentRoute(
      {
        getProjectRoot: () => '/proj',
        getSkillsContext: () => ({
          skillLoader: undefined,
          skillInstaller: undefined,
          projectRoot: '/proj',
          projectSkillsDir: '/proj/.wrongstack/skills',
          globalSkillsDir: '/global/skills',
        }),
        getPromptsContext: () => ({ promptLoader: undefined, promptUsage: undefined as never }),
        getDesignContext: () => ({ projectRoot: '/proj', agentMeta: { meta: {} } }),
      },
      ws,
      { type: 'skills.list' },
    );
    expect(handled).toBe(true);
    expect(sent).toEqual([{ type: 'skills.list', payload: { skills: [], enabled: false } }]);
  });

  it('declines foreign messages without resolving any host capability', async () => {
    const fail = () => {
      throw new Error('should not resolve');
    };
    expect(
      await handleContentRoute(
        {
          getProjectRoot: fail,
          getSkillsContext: fail,
          getPromptsContext: fail,
          getDesignContext: fail,
        },
        {} as WebSocket,
        { type: 'test.foreign' },
      ),
    ).toBe(false);
  });
});
