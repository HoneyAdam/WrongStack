# sc-path-traversal Results — WrongStack

**Skill:** sc-path-traversal
**Date:** 2026-06

## Summary
No new path traversal or LFI findings. Previous related fixes (F-04) verified present and effective.

## Key Controls Verified
- `safeResolveReal` (realpath containment + symlink defense) used by read/edit/write tools.
- `safeResolve` wrapper in multiple FS tools.
- Git worktree validation prevents escape.
- `diff` tool now properly bounds refs.

## Minor Notes
- The `glob` tool intentionally supports `**/*` patterns (feature for codebase search). It is non-mutating and permission:auto — acceptable.
- No `fs.readFile(base + userInput)` or `path.join(dir, userControlled)` without subsequent containment check in security-sensitive code paths.

**Verdict:** Strong. Risk LOW.
**Confidence:** 80
**Findings:** 0
