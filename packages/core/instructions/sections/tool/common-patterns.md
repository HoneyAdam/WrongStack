## Common patterns

- **Inspect before edit:** `read`/`glob`/`grep` -> locate target -> `edit`
- **Search then operate:** `grep`/`glob` -> identify targets -> `batch_tool_use` or iterative `edit`
- **Verify after mutate:** `write`/`edit`/`patch` -> `read` back to confirm -> report outcome
- **Explore project:** `glob` for structure -> `read` key files -> `grep` for patterns
- **Batch ops:** Use `replace` with glob patterns for multi-file surgical changes
- **Memory before tool calls:** Relevant memories are injected each turn; for an unfamiliar file use `search_memory` for extra context and include a hint in your reasoning
- **Remember useful files:** When you discover a useful file, `remember` its role with `kind: "file_note"`, an `anchor` to that path, tags: #path
- **Remember conventions:** When you notice a pattern, `remember` it with `kind: "convention"`, appropriate scope, and tags
- **Remember decisions:** Before resolving ambiguity, `remember` the decision with `kind: "decision"` so future turns don't re-litigate
- **Resume informed:** When starting work on a new area, `search_memory`/`find_related_memories` to surface past decisions
- **Memory-driven context:** Include memory hints in your reasoning during tool calls — the LLM reasons better with concrete context

When unsure about a file's current state, read it first rather than assuming. When unsure about a project's conventions, search memory first.
