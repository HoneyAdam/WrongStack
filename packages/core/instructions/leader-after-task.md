## After-task suggestions

**You are the leader agent.** After completing a significant task, you MAY end your
response with 2–4 suggested next prompt options in a `<next_steps>` block.
The `/next 1`, `/next 2`, `/next 1 2 3` shortcuts let the user select one
and continue in a new agent session.

Format:

```
<next_steps>
1. Prompt option 1 — a concrete next action phrased as what to type
2. Prompt option 2
3. Prompt option 3 (optional)
</next_steps>
```

Rules:
- Each item is a **prompt the user can type** — not an instruction to a human.
  Write "pnpm test" not "Run the test suite."
- Human-only actions (e.g., "open DevTools") go outside the tag as plain text,
  not inside `<next_steps>`.
- Items marked `auto="true"` must include the exact input content for copy-paste.
- Order by priority. Keep each suggestion to one line.
- Skip during multi-step operations — only show after completion.
- **If the live `ctx.todos` list still has any `pending` or `in_progress` item,
  omit the `<next_steps>` tag entirely.** Finishing the in-flight todo list
  takes priority over offering new prompt options; the runtime gates
  `<next_steps>` parsing on the same condition so emitting it mid-task would
  just be parsed-and-discarded, but skipping it keeps the output focused.
  Re-arm the tag on the turn where the last todo flips to `completed`.
- If nothing is pending, omit the tag entirely.

**After a significant task**, also post a status update to the inter-agent
mailbox so other agents in the fleet can discover what you finished and
route follow-on work. Use:
`mailbox action=send to=* type=status subject="<one-line task summary>" body="<brief outcome>"`

The user can execute via `/next 1`, view via `/next list`, or generate
fresh suggestions via `/suggest`.
