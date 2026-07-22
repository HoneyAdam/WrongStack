# /mailbox — Project-wide agent mailbox

The human operator's window into the shared inter-agent mailbox. Every
terminal, TUI, and WebUI session working on the same project shares one
mailbox at `~/.wrongstack/projects/<slug>/_mailbox.jsonl` — agents see
incoming messages automatically on their next iteration (mailbox-loop) and
can write via the `mailbox` tool. `/mailbox` gives **you** the same powers.

## Identity model

Every process registers its agents under a **process-unique id**:
`<base>@<session-tag>` (e.g. `leader@a1b2c3d4`). The bare base id (`leader`) stays
addressable as an **alias** — a message sent to `leader` is received by
*every* live leader session on the project, while `leader@a1b2c3d4` reaches
exactly one. Broadcasts (`*`, alias `all`) reach everyone. Read receipts are
recorded per unique id, so two terminals never consume each other's unread
state.

`/mailbox` acts under the current session's leader identity, so messages
you send are attributed to the same agent your conversation runs as, and
replies addressed to it are folded into your agent's next iteration.

## Subcommands

| Command | Effect |
|---|---|
| `/mailbox` | Unread inbox for this session's leader (marks them read). |
| `/mailbox agents` | All registered agents on the project (`●` = live heartbeat). |
| `/mailbox online` | Only agents with a live heartbeat (last 60s). |
| `/mailbox send <id> <message>` | Direct message an agent (ids from `agents`). |
| `/mailbox broadcast [audience=leaders] <message>` | Message every agent, or only leader agents. |
| `/mailbox history [n]` | Last *n* messages on the project (default 20). |
| `/mailbox clear` | Delete all messages from the mailbox. |

Alias: `/mb`.

## Examples

```
/mailbox broadcast pausing deploys, hold off on main
/mailbox broadcast audience=leaders operator context for terminal/WebUI leaders only
/mailbox send leader@a1b2c3d4 can you take the auth refactor?
/mailbox agents
```

## How agents receive messages

Before each LLM call, the agent loop checks the mailbox for messages
addressed to its unique id, its base alias, or `*`. Fresh eligible mail is
injected for one model evaluation and its raw block is then removed. Only a
concise durable conclusion/action, assistant response, or resulting tool/task
state needs to remain; routine mail can simply be absorbed and discarded.
Agents write with `mail_send` (direct or `to="*"`), catch up
with `mail_inbox` (reads + marks read), or use the multi-action
`mailbox` power-tool — all registered in CLI and WebUI surfaces and
available to fleet subagents. The system prompt grants this authority
explicitly (identity model, broadcast-milestones etiquette,
answer-your-mail).

Set `audience="leaders"` on `mail_send`/`mailbox action=send`, or use
`audience=leaders` with `/mailbox send` and `/mailbox broadcast`, for context
that only the main agent should consume. The operator mailbox UI still shows
these records, while subagent loop injection, inbox, unread count, and tool
query results exclude them.

See also: `/mailbox-demo` (test harness with a separate demo identity).
