# Verified Findings — WrongStack (security-check Phase 3)

**Date:** 2026-06 (full rescan after deletion of prior report)
**Verifier:** sc-verifier (false-positive elimination, reachability, context, confidence scoring)
**Input:** All Phase 2 *-results.md + architecture + dependency-audit

## Overall Result
**0 Critical, 0 High, 0 Medium, 0 Low active findings** from the new scan.

All previously reported HIGH (F-01) and MEDIUM (F-02, F-03) issues from the 2026-05-31 scan have been **verified fixed** in the current tree:
- diff argument injection guard present and effective.
- Tool registry ownership / subagent permission guards improved (fail-closed on dangerous ops for subagents).
- Path containment, SSRF, secret scrubbing, and MCP URL validation all verified in place.

## False Positives / Out of Scope Eliminated
- Many "RCE via bash" and "path traversal via tools" signals were correctly classified as **designed agent capabilities** with explicit user-permission + validation layers (per SECURITY.md threat model). Not vulnerabilities.
- SQLi / NoSQLi / GraphQL / LDAP / SSTI / XXE families: N/A (no database drivers, no query builders, no XML/template engines processing untrusted LLM input in core).
- React `dangerouslySetInnerHTML` etc.: N/A in Ink TUI; webui is local dev surface.

## Remaining Informational / Hardening Notes (Low / Info)
- (INFO) Continue to evolve permission model toward explicit allowlists where practical (ongoing).
- (INFO) Consider adding `pnpm audit --audit-level=moderate` as explicit gate in release workflow (defense-in-depth).
- (INFO) The `postinstall` git-hooks setup remains a dev-ergonomics choice (same as prior scan).

## Confidence Scoring Summary
- All high-risk surfaces (shell, FS mutation, subagent dispatch, secret handling, network egress) received 75–90 confidence reviews.
- No findings required de-duplication or reachability analysis beyond the above.

**Scan is clean.** Residual risk is **LOW** and consists entirely of intentional powerful tooling for a local developer agent, protected by the documented multi-layer controls.
