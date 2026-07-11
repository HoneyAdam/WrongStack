# Desktop Distribution

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

## Outcome

Turn the existing Electron shell into a supported desktop product with WebUI feature parity, signed installers, safe updates, diagnostics, and release ownership.

## Scope

- Windows, macOS, and Linux packaging with a documented support matrix.
- Code signing/notarization where platforms require it.
- Auto-update channels with signature verification and rollback guidance.
- Deep links, file/folder open flows, tray/background behavior, and single-instance handling.
- Crash reporting that is opt-in and redacts project content.
- Desktop smoke tests and release artifacts generated in CI.

## Delivery plan

1. Define the parity checklist and Electron security baseline.
2. Stabilize packaging and local installer smoke tests.
3. Add signing/notarization and staged release channels.
4. Add update UX, rollback, and diagnostic bundles.
5. Publish platform support and incident/revocation procedures.

## Acceptance criteria

- Context isolation is enabled; renderer code has no unrestricted Node access.
- Updates are cryptographically verified and cannot downgrade silently.
- Desktop can create, resume, rename, and safely close sessions with the same writer invariants as CLI/WebUI.
- Install, launch, update, and uninstall smoke tests run for every supported platform.

