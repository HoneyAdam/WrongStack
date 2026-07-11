## Common patterns

- **Inspect before edit:** `read`/`glob`/`grep` -> locate target -> `edit`
- **Search then operate:** `grep`/`glob` -> identify targets -> `batch_tool_use` or iterative `edit`
- **Verify after mutate:** `write`/`edit`/`patch` -> `read` back to confirm -> report outcome
- **Explore project:** `glob` for structure -> `read` key files -> `grep` for patterns
- **Batch ops:** Use `replace` with glob patterns for multi-file surgical changes
- **Context before acting:** Before editing a file or directory, `search_memory` for relevant project context, decisions, or conventions
- **Remember as you go:** After discovering a project convention, making a design decision, or spotting an anti-pattern, `remember` it with type + tags so future sessions benefit
- **Resume informed:** When starting work on a new area, `search_memory`/`find_related_memories` to surface past decisions and existing knowledge about that area

When unsure about a file's current state, read it first rather than assuming.
