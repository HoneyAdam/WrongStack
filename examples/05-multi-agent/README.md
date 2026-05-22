# 05 — Multi-Agent

Director fleet orchestration, `/spawn`, `/fleet`, and `/steer`.

## Basic director run

```bash
wrongstack --director "audit packages/core for security issues"
```

The Director plans the work, spawns specialized subagents
(`bug-hunter`, `security-scanner`, `refactor-planner`, `audit-log`),
and rolls up the results. Each subagent gets its own context, model,
and session transcript on disk.

## Promote at runtime

If you started without `--director`, you can flip into director mode
mid-session (must be called before any subagent is spawned):

```
/director
```

## Eternal autonomy with a locked-in mission

```bash
wrongstack --tui --eternal "add comprehensive error handling to every tool in packages/tools"
```

The engine drives sense → decide → execute → reflect cycles until you
stop it with `Esc` / `Ctrl+C` / `/autonomy stop`. The mission persists
to `.wrongstack/goal.json` so you can resume later.

## Custom subagent spawn

`/spawn` requires `key=value` flag syntax:

```
/spawn --provider=groq --model=llama-3.3-70b-versatile --name=reviewer --tools=read,grep,edit "review the auth module for race conditions"
```

Short forms also work:

```
/spawn -p groq -m llama-3.3-70b-versatile -n reviewer "find dead code under src/utils"
```

> `--role` is **not** a `/spawn` flag — roster roles (`bug-hunter`,
> `security-scanner`, …) are picked by the LLM itself through the
> `delegate` tool when running under `--director`. From the user side,
> just describe the work and let the director pick the role, or pass
> `--name=<role>` to label the subagent yourself.

## Fleet management

```
/fleet status          # task progress per subagent
/fleet usage           # token + cost breakdown
/fleet log <id>        # compact transcript summary
/fleet log <id> raw    # full per-subagent JSONL dump
/fleet kill <id>       # stop a specific subagent
/fleet manifest        # full fleet snapshot
/fleet retry <id>      # respawn a failed subagent (or `all` to retry every failure)
/fleet stream on|off   # toggle live subagent text streaming in the TUI
```

`/agents` is the shorter view — just the current roster with status
chips for any failures.

## Steering mid-flight

Redirect the agent while it's working:

```
/steer focus only on the security-critical paths, skip tests
```

Or press **Esc** in the TUI then start typing — same effect.

## /goal — persistent mission + lock-in preamble

```
/goal                   # show current goal + recent journal
/goal <text>            # set the goal AND inject the full-autonomy preamble
/goal set <text>        # explicit set form (same as the line above)
/goal clear             # stop eternal mode on the next cycle
/goal journal [N]       # last N journal entries (default 25, max 500)
```

The goal persists to `<projectRoot>/.wrongstack/goal.json` and is what
`/autonomy eternal` reads on every cycle.

## Multi-provider fleet

Different subagents can run on different providers without any extra
config — the Director picks per task:

```bash
wrongstack --director "compare three implementation strategies for the import resolver and recommend one"
```

The Director may spawn a cheap fast model for exploration, a strong
model for the deep analysis, and another fast model for the writeup.

## Observability

```
/agents                  # roster with status chips
/fleet status            # task-level progress
/metrics                 # live token / cost / iteration counters
```

In the TUI you also get:

- **LiveActivityStrip** (above the input): one line per running
  subagent — tool currently in flight, elapsed, iteration + tool-call
  counters.
- **FleetPanel**: full roster with per-subagent tokens and cost.
- **Chat**: agent text and lifecycle summaries only (no tool spam).
