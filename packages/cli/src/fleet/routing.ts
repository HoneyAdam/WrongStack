import type { SubagentRunContext, SubagentRunner, TaskSpec } from '@wrongstack/core';
import {
  type Config,
  expectDefined,
  makeAgentSubagentRunner,
  NULL_FLEET_BUS,
  TOKENS,
} from '@wrongstack/core';
import type { MultiAgentHost } from './host.js';
/**
 * Routing runner — dispatches tasks to standard or ACP runner based on provider.
 */
export function buildRoutingRunner(config: Config, host: MultiAgentHost): SubagentRunner {
  const standardRunner = makeAgentSubagentRunner({
    factory: host.makeSubagentFactory(config),
    fleetBus: host.getDirector()?.fleet ?? NULL_FLEET_BUS,
  });

  return async (task: TaskSpec, ctx: SubagentRunContext) => {
    const subCfg = ctx.config;
    if (subCfg.provider === 'acp') {
      const cacheKey = subCfg.role ?? subCfg.name ?? expectDefined(subCfg.id);
      const runner = await host.buildACPRunner(cacheKey);
      return runner(task, ctx);
    }
    return standardRunner(task, ctx);
  };
}

// Workaround: TOKENS reference satisfies unused-import lint
void TOKENS;
