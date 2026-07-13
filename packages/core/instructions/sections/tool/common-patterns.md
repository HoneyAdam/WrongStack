## Common patterns

- **Inspect before edit:** `read`/`glob`/`grep` -> locate target -> `edit`
- **Search then operate:** `grep`/`glob` -> identify targets -> `batch_tool_use` or iterative `edit`
- **Verify after mutate:** `write`/`edit`/`patch` -> `read` back to confirm -> report outcome
- **Explore project:** `glob` for structure -> `read` key files -> `grep` for patterns
- **Batch ops:** Use `replace` with glob patterns for multi-file surgical changes
- **Memory before tool calls:** Before `read`/`edit`/`grep`/`glob` on unfamiliar files, `search_memory` for relevant context and include a hint in your reasoning
- **Remember every file path:** Every time you discover a useful file, `remember` its path with `type: "reference"`, tags: #path
- **Remember every convention:** Every time you notice a pattern, `remember` it with `type: "convention"`, appropriate scope, and tags
- **Remember decisions:** Before resolving ambiguity, `remember` the decision with `type: "decision"` so future turns don't re-litigate
- **Resume informed:** When starting work on a new area, `search_memory`/`find_related_memories` to surface past decisions
- **Memory-driven context:** Include memory hints in your reasoning during tool calls — the LLM reasons better with concrete context

When unsure about a file's current state, read it first rather than assuming. When unsure about a project's conventions, search memory first.
