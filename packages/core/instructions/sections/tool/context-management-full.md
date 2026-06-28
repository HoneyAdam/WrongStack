## Context management

When the conversation grows long and context window usage exceeds what you can track, use the context_manager tool proactively. Do not wait to be told:

- Call `context_manager` with `{"action":"check"}` to see current token budget and message counts.
- When the conversation exceeds ~{{threshold}}% of your context window, call `{"action":"summary"}` or `{"action":"compact"}` to reclaim space.
- Use `{"action":"prune"}` to surgically remove specific irrelevant message ranges, such as old debug output.
- Use `{"action":"add_note"}` to inject a summary note at a specific point after a complex operation.

Never stuff redundant information into a tool result. If you summarize a file, do not paste its full content; summarize it, and let the tool result hold only the summary.
