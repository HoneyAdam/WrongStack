/**
 * SecretVault encrypts secrets-at-rest in config files. The wire format is
 * `enc:v1:<base64-iv>:<base64-tag>:<base64-ciphertext>`. Plaintext strings
 * (those that do not match this prefix) are passed through unchanged so that
 * existing configs and env-var-derived values keep working.
 *
 * The vault is intentionally NOT designed to defeat a determined local
 * attacker who can read both the config file and the key file — that level
 * of secrecy needs the OS keychain. The goal is to keep keys from being
 * visible in screen shares, accidental log captures, and `cat config.json`
 * over someone's shoulder.
 */
export interface SecretVault {
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
  isEncrypted(value: string): boolean;
}

export const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * No-op SecretVault that passes values through unchanged.
 * Used in contexts where encryption is not needed — e.g. reading/writing
 * config sections that contain no secret fields (models, settings, etc.).
 */
export const noOpVault: SecretVault = {
  encrypt: (v) => v,
  decrypt: (v) => v,
  isEncrypted: () => false,
};
