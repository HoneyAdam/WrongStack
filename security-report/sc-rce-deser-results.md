# sc-rce-deser Results — WrongStack

**Skill:** sc-rce + sc-deserialization
**Date:** 2026-06 (full rescan)

## Summary
No critical or high RCE or insecure deserialization findings.

## Analysis

### Remote Code Execution Vectors
- All `child_process` usage is centralized in three controlled files:
  - `packages/tools/src/bash.ts` (user's shell, permission-gated, env-scrubbed, process-group killing)
  - `packages/tools/src/exec.ts` (strict allowlist of commands; explicitly blocks `--eval`, `-e`, `--require` etc.)
  - `packages/tools/src/git.ts` (args validated, worktree containment)
- The `diff` tool now rejects leading `-` on `a`/`b` refs (verified fix for previous F-01 HIGH).
- No `eval()`, `new Function(string)`, `vm.runIn*` on untrusted data anywhere in production source.
- No template compilation of user/LLM-controlled strings (no Handlebars.compile, ejs.render with user template, etc.).

### Deserialization
- Session/memory stores use JSONL + better-sqlite3 (controlled schemas).
- No `JSON.parse` of fully untrusted data followed by prototype-polluting merges or `as any` assignment to security-critical objects.
- MCP client uses strict JSON-RPC 2.0 parsing with known schemas.

**Conclusion:** Previous HIGH (F-01) verified fixed. Current RCE surface is a *designed feature* (powerful local agent) with strong, multi-layer controls. No new issues found.

**Confidence:** 85
**Findings:** 0 new
