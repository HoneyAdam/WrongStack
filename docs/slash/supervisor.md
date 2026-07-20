# /supervisor — brain-gated fleet supervision

Inspects and toggles the **FleetSupervisor**: an always-on shadow watcher
over the Director fleet that detects queue imbalance and worker distress,
clears every proposed intervention through the tiered Brain (policy → LLM →
human, honoring the `/brain risk` ceiling), and then acts — rebalancing
pending tasks off busy workers ("I'm reducing your workload"), spawning
helpers on deep backlogs, steering stuck or repeatedly-failing workers by
mail, and keeping the leader informed.

It starts automatically when the Director fleet comes up (Director Mode is
hard-coded on, so the fleet is always available), provided a Brain is available and
`fleet.supervisor.enabled` is not `false`.

## Subcommands

| Command | Effect |
|---|---|
| `/supervisor` | Status: armed state, resolved config, engagement count, last activity. |
| `/supervisor status` | Same as `/supervisor`. |
| `/supervisor on` | Arm the evaluation loop for this session. |
| `/supervisor off` | Disarm it — no further automatic interventions. |
| `/supervisor log [n]` | Show the last *n* signal→decision→action entries (default 10). |

## Signals and actions

| Signal | Trigger | Action (brain-gated) | Risk |
|---|---|---|---|
| `pinned_starvation` | pending task pinned to a busy worker > `pinnedWaitMs` while a sibling idles | retarget to the idle worker + steer the loser + notify leader | low |
| `overloaded_worker` | ≥ `overloadPinnedThreshold` pending tasks pinned to one worker with an idle sibling | retarget the queue tail (head stays) | low |
| `backlog` | pending > `backlogFactor` × live workers for 2 ticks | spawn one helper worker | medium |
| `stuck_agent` | running worker with no tool activity for `stuckMs` | steer mail + notify leader | medium |
| `failure_streak` | ≥ `failureStreak` consecutive failed/timeout tasks from one worker | steer — or terminate when `allowTerminate` | high |
| `idle_with_work` | idle workers while pending tasks cannot dispatch | notify leader | low |

Hard rules: **running tasks are never pulled** (only still-pending tasks
move — the losing worker gets a steer mail naming the moved task ids); each
task is retargeted at most once; per-(signal,worker) cooldown
(`cooldownMs`, default 120s); at most `maxInterventionsPerSubagent`
interventions per worker per run; a single engagement in flight; dormant
after `work_complete`. The supervisor never participates in budget
extend/deny negotiation and never flips autonomy mode.

## Configuration

active profile config → `fleet.supervisor` (the whole `fleet` key is
**deny-listed for in-project config** — a repo-committed
`.wrongstack/config.json` cannot enable or tune supervision):

```jsonc
{
  "fleet": {
    "supervisor": {
      "enabled": true,                 // kill switch
      "intervalMs": 20000,             // evaluation tick
      "cooldownMs": 120000,            // per-(signal,worker) re-engagement gap
      "maxInterventionsPerSubagent": 3,
      "pinnedWaitMs": 60000,
      "overloadPinnedThreshold": 2,
      "backlogFactor": 2,
      "stuckMs": 180000,
      "failureStreak": 2,
      "allowSpawn": true,
      "allowTerminate": false          // opt-in — highest-risk action
    }
  }
}
```

## Relationship to /shadow and /brain

- `/shadow` is the **on-demand LLM fleet inspector** (one-shot pass,
  explicit `hoop` interventions). `/supervisor` is the **continuous
  rule-first watcher** that only consults the LLM tier for approval.
- Every supervisor decision flows through the same session Brain — `/brain`
  history shows them, and `/brain risk` caps what it may auto-approve.

## Observability

Kernel events `fleet.supervisor.signal`, `fleet.supervisor.decision`, and
`fleet.supervisor.action` carry the full audit trail (also available via
`/supervisor log`).
