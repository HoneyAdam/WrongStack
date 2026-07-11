# MCP Registry and Installation

**Priority:** P2  
**Horizon:** 6–12 months  
**Status:** Proposed

## Outcome

Offer discoverable, versioned MCP server installation while maintaining a strict separation between untrusted repository configuration and executable user-local configuration.

## Scope

- `wstack mcp search` and `wstack mcp install <registry:id>`.
- Signed or checksum-pinned catalog metadata with publisher identity.
- Version constraints, update checks, compatibility metadata, and rollback.
- Permission/capability preview before installation.
- Curated presets and community sources with visibly different trust levels.

## Architecture

- Registry URLs and installed server commands remain user-global or project-local private config only.
- Installation resolves to a concrete immutable command/package digest.
- Catalog parsing is bounded and cannot inject prompts or configuration fields.
- Reuse the surface-agnostic management core rather than implementing separate CLI and WebUI installers.

## Delivery plan

1. Specify catalog and lockfile formats.
2. Add read-only search and metadata verification.
3. Add install/update/remove with lockfile and rollback.
4. Add trust badges, permission previews, and WebUI parity.
5. Publish a curated starter catalog and supply-chain response process.

## Acceptance criteria

- A registry entry cannot silently change the installed executable without a version/digest change.
- Install never writes executable MCP configuration from in-project config.
- Offline startup uses the locked installation and cached tool/resource manifests.
- Compromised registry and dependency scenarios have documented revocation behavior.

