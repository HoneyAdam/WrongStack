export {
  InMemoryAgentBridge,
  InMemoryBridgeTransport,
  createMessage,
} from './agent-bridge.js';

export {
  AUDIT_LOG_AGENT,
  BUG_HUNTER_AGENT,
  REFACTOR_PLANNER_AGENT,
  SECURITY_SCANNER_AGENT,
  /**
   * Public fleet role registry consumed by CLI director/delegate wiring and
   * plugin API consumers. Keep exported from this barrel for compatibility.
   */
  FLEET_ROSTER,
  ALL_FLEET_AGENTS,
} from './fleet.js';
