/**
 * Shadow Agent Role Definition
 *
 * Subagent configuration for the fleet roster. Spawn this role to get a
 * background monitoring agent that watches the fleet, detects anomalies,
 * and can intervene on command.
 */
import type { SubagentConfig } from '../../types/multi-agent.js';
import { agentPrompt } from './agent-prompts.js';

export const SHADOW_AGENT: SubagentConfig = {
  id: 'shadow-agent',
  name: 'Shadow',
  role: 'shadow-agent',
  prompt: agentPrompt('shadow-agent'),
};
