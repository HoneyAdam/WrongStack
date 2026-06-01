# sc-lang-typescript Results — WrongStack

**Skill:** sc-lang-typescript (deep scan against 400+ item checklist)
**Date:** 2026-06 (full rescan)

## Summary
TypeScript codebase is clean of the high-severity language-specific anti-patterns. Strong use of strict types, no dangerous dynamic code, good boundaries.

## High-Severity Patterns — Not Present
- No `eval(userInput)`, `new Function(string)`, `vm.runIn*` on attacker-controlled data.
- No prototype-polluting deep merges on LLM/file/MCP input.
- No `path.join(base, userControlled)` without subsequent realpath containment check in mutating tools.
- No `child_process.exec` / `spawn(..., {shell:true})` with unsanitized LLM args (controlled wrappers only).
- No `dangerouslySetInnerHTML` with unsanitized data in React/Ink surfaces (Ink uses text-based rendering).
- No raw SQL/NoSQL (N/A — no DB drivers in agent core).
- No JWT client-side storage issues (no JWTs in the agent).
- No ReDoS-prone regex on hot untrusted input paths (regex usage is limited and on controlled data).
- `as any` / `@ts-ignore` usage exists in non-security-critical glue (normal in large TS projects); no bypass of auth/validation logic found.

## Medium/Low Observations
- Some use of `any` in plugin/MCP dynamic typing — acceptable (external surface).
- WebUI uses Vite/React; standard safeguards apply.
- CI uses Biome + Vitest + tsc — good.

**Verdict:** The TypeScript codebase follows modern secure coding practices for an agentic system. The dangerous operations are intentionally exposed via tools but heavily mediated by the permission + validation layers documented in SECURITY.md.
**Confidence:** 80
**Findings:** 0 high/critical; 3 informational (style / future-hardening)
