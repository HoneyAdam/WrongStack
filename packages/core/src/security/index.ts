// Security domain: secret scrubbing, vault encryption, permission policies
export { DefaultSecretScrubber } from './secret-scrubber.js';
export {
  DefaultSecretVault,
  type SecretVaultOptions,
  decryptConfigSecrets,
  encryptConfigSecrets,
  rewriteConfigEncrypted,
  migratePlaintextSecrets,
} from './secret-vault.js';
export { isSecretField } from './config-secrets.js';
export {
  DefaultPermissionPolicy,
  AutoApprovePermissionPolicy,
  type PermissionPolicyOptions,
} from './permission-policy.js';
