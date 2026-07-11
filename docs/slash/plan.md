# /plan — Strategic plan board

Inspect and manage the persisted strategic plan for the current project
session. `/plan` uses the existing plan store; it does not create a second
planning model alongside the `plan` tool or live todos.

## Usage

```text
/plan [show|add|start|done|remove|promote|derive|taskify|template|clear] [--json]
```

## Read-only operations

| Command | Result |
|---|---|
| `/plan` or `/plan show` | Show the persisted plan. |
| `/plan template list` | List bundled plan templates. |

## Mutating operations

| Command | Result |
|---|---|
| `/plan add <title>` | Add an open item. |
| `/plan start <id\|index>` | Mark an item in progress. |
| `/plan done <id\|index>` | Mark an item done. |
| `/plan remove <id\|index>` | Remove an item. |
| `/plan promote <id\|index> [subtasks...]` | Derive live todos and mark the plan item in progress. |
| `/plan taskify <id\|index>` | Copy an item into the configured task store. |
| `/plan template use <name>` | Append all items from a bundled template. |
| `/plan clear` | Remove every plan item. |

Mutations use the plan store's file lock and atomic write path. Structured
results are produced from the `PlanFile` returned after persistence succeeds.

## Structured output

Add `--json` to any operation. Successful plan operations return an object
containing `ok: true` and the persisted `plan`. Commands such as `taskify`,
`promote`, and `template list` include their task, todo, or template data.
Errors return `ok: false` with a stable error code.

The same payload is attached at `metadata.plan` for TUI and other host
surfaces.

## Examples

```text
/plan add Implement MCP resource discovery
/plan start 1
/plan show --json
/plan template use new-feature
```
