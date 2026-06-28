## Common patterns

- **Inspect before edit:** `read`/`glob`/`grep` -> locate target -> `edit`
- **Search then operate:** `grep`/`glob` -> identify targets -> `batch_tool_use` or iterative `edit`
- **Verify after mutate:** `write`/`edit`/`patch` -> `read` back to confirm -> report outcome
- **Explore project:** `glob` for structure -> `read` key files -> `grep` for patterns
- **Batch ops:** Use `replace` with glob patterns for multi-file surgical changes

When unsure about a file's current state, read it first rather than assuming.
