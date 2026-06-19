# SecretVault Key Rotation Implementation

## Overview

Implemented key rotation support for SecretVault with versioned encryption prefixes (`enc:v1:`, `enc:v2:`, etc.). This allows users to rotate their encryption keys while maintaining backward compatibility with existing encrypted values.

## Changes Made

### 1. Type System Updates (`packages/core/src/types/secret-vault.ts`)

- Added `keyVersion: number` property to `SecretVault` interface
- Created new `RotatableSecretVault` interface extending `SecretVault` with `rotateKey()` method
- Added helper functions:
  - `encryptedPrefixForVersion(version: number): string` - Generate prefix for a version
  - `parseEncryptedVersion(value: string): number | undefined` - Parse version from encrypted value
- Added `ENCRYPTED_PREFIX_PATTERN` regex to match any versioned prefix
- Updated `noOpVault` to include `keyVersion: 1`

### 2. Core Implementation (`packages/core/src/security/secret-vault.ts`)

#### DefaultSecretVault Class
- Added `_keyVersion: number` private field (starts at 1)
- Added `keyVersion` getter property
- Updated `isEncrypted()` to recognize all version prefixes using regex
- Updated `encrypt()` to emit current version prefix
- Updated `decrypt()` to parse and handle any version prefix
- Implemented `rotateKey()` method:
  - Generates new 32-byte key
  - Increments version counter
  - Writes versioned key file (37 bytes: 4-byte magic + 1-byte version + 32-byte key)
  - Returns `{ oldVersion, newVersion }`

#### Key File Format
- **Legacy (v1)**: 32 raw bytes
- **Versioned (v2+)**: `WSKV` magic (4 bytes) + version byte (1 byte) + key (32 bytes) = 37 bytes
- Automatic detection and backward compatibility maintained

#### New Function: `rotateConfigKeys()`
- Atomic operation that:
  1. Reads config file
  2. Decrypts all encrypted values with old key
  3. Calls `vault.rotateKey()` to generate new key
  4. Re-encrypts all values with new key (new version prefix)
  5. Writes config file atomically
- Returns `{ rotated: number, oldVersion: number, newVersion: number, file: string }`
- Handles edge cases:
  - Missing config file (rotates key only)
  - Invalid JSON (warns and skips)
  - No encrypted fields (rotates key only)

### 3. Exports (`packages/core/src/security/index.ts`)

- Exported `rotateConfigKeys` function
- Exported `RotatableSecretVault` type

### 4. Bug Fix (`packages/cli/src/slash-commands/auth.ts`)

- Added `keyVersion: 1` to inline vault object to satisfy `SecretVault` interface

### 5. Tests (`packages/core/tests/security/secret-vault.test.ts`)

Added comprehensive test coverage (12 new tests):

#### Key Version Tests
- ✅ Starts at keyVersion 1 for new vaults
- ✅ encrypt emits enc:v1: prefix before rotation
- ✅ rotateKey increments version and writes versioned key file
- ✅ rotateKey generates a new key that differs from the old one
- ✅ Multiple rotations increment version correctly

#### Version Compatibility Tests
- ✅ isEncrypted recognizes all version prefixes
- ✅ New vault instance reads versioned key file correctly
- ✅ Legacy 32-byte key file is still readable

#### Config Rotation Tests
- ✅ rotateConfigKeys re-encrypts all secrets with new key
- ✅ rotateConfigKeys handles missing config file gracefully
- ✅ rotateConfigKeys handles config with no encrypted fields
- ✅ rotateConfigKeys handles malformed JSON gracefully

## Usage Examples

### Basic Key Rotation

```typescript
import { DefaultSecretVault } from '@wrongstack/core/security';

const vault = new DefaultSecretVault({ keyFile: '/path/to/key' });

// Check current version
console.log(vault.keyVersion); // 1

// Encrypt with v1
const enc1 = vault.encrypt('secret'); // enc:v1:...

// Rotate key
const { oldVersion, newVersion } = vault.rotateKey();
console.log(oldVersion); // 1
console.log(newVersion); // 2
console.log(vault.keyVersion); // 2

// New encryptions use v2
const enc2 = vault.encrypt('secret'); // enc:v2:...

// v1 values cannot be decrypted (different key material)
try {
  vault.decrypt(enc1); // Throws: authentication failed
} catch (e) {
  console.log('Old values need re-encryption');
}
```

### Config File Rotation

```typescript
import { rotateConfigKeys, DefaultSecretVault } from '@wrongstack/core/security';

const vault = new DefaultSecretVault({ keyFile: '/path/to/key' });

// Rotate key and re-encrypt all secrets in config
const result = await rotateConfigKeys('/path/to/config.json', vault);

console.log(result);
// {
//   rotated: 5,           // Number of fields re-encrypted
//   oldVersion: 1,
//   newVersion: 2,
//   file: '/path/to/config.json'
// }
```

## Security Considerations

1. **Key Material Changes**: After rotation, the actual encryption key changes, not just the version prefix. Old encrypted values cannot be decrypted with the new key.

2. **Atomic Operations**: `rotateConfigKeys()` uses atomic write operations to prevent data loss if the process is interrupted.

3. **Backward Compatibility**: The vault can still read legacy 32-byte key files (v1 format) and automatically detects the format.

4. **Version Tracking**: Each encrypted value carries its version prefix, making it clear which key version was used for encryption.

## Test Results

All tests pass:
- ✅ 306 security tests (including 12 new key rotation tests)
- ✅ TypeScript type checking passes across all packages
- ✅ No breaking changes to existing functionality

## Files Modified

1. `packages/core/src/types/secret-vault.ts` - Type definitions
2. `packages/core/src/security/secret-vault.ts` - Core implementation
3. `packages/core/src/security/index.ts` - Exports
4. `packages/cli/src/slash-commands/auth.ts` - Bug fix
5. `packages/core/tests/security/secret-vault.test.ts` - Tests

## Future Enhancements

Potential improvements for future iterations:

1. **CLI Command**: Add `wstack auth rotate` command for easy key rotation
2. **Automatic Rotation**: Option to auto-rotate keys after N days
3. **Multi-Key Support**: Support for multiple active keys during rotation transitions
4. **Rotation Audit Log**: Track rotation history with timestamps
5. **Graceful Migration**: Support for gradual migration where both old and new keys work for a transition period
