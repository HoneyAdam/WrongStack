# /provider-status

Inspect and control the shared provider/model health tracker used by the leader,
Chimera/fleet subagents, one-shot helpers, and fallback routing.

## Usage

```text
/provider-status
/provider-status waiting
/provider-status blocked
/provider-status degraded
/provider-status healthy
/provider-status retry <provider> <model>
/provider-status clear <provider> <model>
/provider-status clear
```

`waiting` is an operator-friendly alias for `blocked`.

## States

| State | Meaning | Routing behavior |
|---|---|---|
| `healthy` | No active failure gate. | Eligible for normal routing. |
| `degraded` | Recent failures crossed the degradation threshold. | Still eligible, but tracked as flaky. |
| `blocked` | Cooldown, quota reset, or failure threshold is active. | Removed from primary/fallback attempts. |

The command shows failure/success totals, consecutive failures, rate-limit
count, last error, originating session/agent where known, and remaining
cooldown.

## Provider-wide quota

The displayed status row is a provider/model observation, but an account or
plan quota may also quarantine the logical provider. In that case sibling
models on the same provider are unavailable even if they do not yet have their
own error row. Model-scoped quota only blocks the observed pair.

Gateway-backed providers may normalize wire ids into logical provider/model
identities. Use the identity printed by this command for `retry` and `clear`.

## Retry versus clear

`retry <provider> <model>` releases a waiting entry so its next real use becomes
a half-open probe. It does not issue a provider request by itself and does not
guarantee that routing will select the route immediately.

`clear <provider> <model>` removes counters and health history for one pair.
`clear` without a target removes all tracker state. Clearing is stronger than a
retry request and should normally be reserved for corrected configuration or
operator diagnosis.

For provider-wide quota, releasing/clearing the observed pair also removes the
provider-level waiting gate. If the plan is still exhausted, the next probe
will restore the block and its reset time.

## Persistence

The CLI persists the reset-room snapshot and restores unexpired entries on the
next session. Expired entries are discarded or swept back to healthy. This
prevents a restart from immediately repeating calls that a provider already
said cannot succeed until a later reset.

## Related

- `/fallback` — configure the continuity bridge and ordinary chains.
- `/shadow` — quota-triggered post-work continuity audit.
- [Provider continuity](../provider-continuity.md) — routing order, reset-time
  parsing, multi-agent sharing, and troubleshooting.
