// Security domain: secret scrubbing, vault encryption, permission policies
export { DefaultSecretScrubber } from './secret-scrubber.js';
export {
  DefaultSecretVault,
  type SecretVaultOptions,
  rewriteConfigEncrypted,
  migratePlaintextSecrets,
  rotateConfigKeys,
} from './secret-vault.js';
export { decryptConfigSecrets, encryptConfigSecrets, isSecretField } from './config-secrets.js';
export {
  DefaultPermissionPolicy,
  AutoApprovePermissionPolicy,
  type PermissionPolicyOptions,
} from './permission-policy.js';
export {
  TRUST_POLICY_JSON_SCHEMA,
  TRUST_POLICY_LIMITS,
  TRUST_POLICY_SCHEMA_VERSION,
  type TrustPolicyDiagnostic,
  type TrustPolicyDiagnosticCode,
  type TrustPolicyValidationResult,
  validateTrustPolicy,
} from './permission-policy-schema.js';

export {
  ToolCapabilities,
  DANGEROUS_FOR_SUBAGENTS,
  type ToolCapability,
  hasDangerousCapabilityForSubagents,
  hasCapability,
  getDangerousCapabilities,
} from './capabilities.js';
export {
  evaluateToolKanbanBoundary,
  type ToolKanbanBoundaryEvaluation,
} from './kanban-boundary.js';
