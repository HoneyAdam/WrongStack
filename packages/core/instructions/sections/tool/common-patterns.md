## Common patterns

- **Inspect before edit:** live `codebase-search` -> `read` target -> `edit`; use `grep` for exact-text confirmation
- **Search then operate:** live `codebase-stats` -> missing index? live `codebase-index` -> `codebase-search` -> identify targets -> `batch_tool_use` or iterative `edit`
- **Verify after mutate:** `write`/`edit`/`patch` -> `read` back to confirm -> report outcome
- **Explore project:** prefer live index-backed search for code concepts; use `tree`/`glob` for layout and paths, or as fallback when indexing is unavailable
- **Batch ops:** Use `replace` with glob patterns for multi-file surgical changes
- **Memory before tool calls:** Relevant memories are injected each turn; for an unfamiliar file use `memory_search` for extra context and include a hint in your reasoning
- **Remember useful files:** When you discover a useful file, `remember` its role with `kind: "file_note"`, an `anchor` to that path, tags: #path
- **Remember conventions:** When you notice a pattern, `remember` it with `kind: "convention"`, appropriate scope, and tags
- **Remember decisions:** Before resolving ambiguity, `remember` the decision with `kind: "decision"` so future turns don't re-litigate
- **Resume informed:** When starting work on a new area, `memory_search`/`memory_graph` to surface past decisions
- **Memory-driven context:** Include memory hints in your reasoning during tool calls — the LLM reasons better with concrete context

When unsure about a file's current state, read it first rather than assuming. When unsure about a project's conventions, search memory first.
