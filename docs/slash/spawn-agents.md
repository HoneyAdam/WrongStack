# /spawn · /agents · /director — Multi-Agent Commands

## /spawn

Spawns an isolated subagent to handle a specific task. The subagent gets its own fresh `Context`, `Agent`, `EventBus`, and session JSONL — completely isolated from the leader's state.

**Flags:**
```
/spawn [--provider=<id>] [--model=<id>] [--name=<label>] [--tools=a,b,c] <task description>
```

| Flag | Effect |
|---|---|
| `--provider` | Use a specific provider for this subagent |
| `--model` | Use a specific model for this subagent |
| `--name` | Label for the subagent in fleet status |
| `--tools` | Whitelist of tool names the subagent can use |

Returns a summary of what was spawned.

## /agents

Shows status of all spawned subagents: their name, current task, status (pending/running/done/failed), and iteration count. Returns output from `opts.onAgents()`.

## /director

Promotes the session to director mode, enabling fleet orchestration tools (`spawn_subagent`, `assign_task`, `await_tasks`, `fleet_status`, etc.). Only works **before** any subagents are spawned — the coordinator must not already be active.

Returns error if subagents already exist, or success message with director state summary.

## Code reference

- `packages/cli/src/slash-commands/spawn-agents.ts`
- `packages/cli/src/multi-agent.ts` — `MultiAgentHost` wiring
- `packages/core/src/coordination/multi-agent-coordinator.ts`
- `packages/core/src/coordination/director.ts` — director orchestration