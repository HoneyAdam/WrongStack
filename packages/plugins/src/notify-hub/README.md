# notify-hub plugin

POSTs session events (stop, tool errors, budget thresholds) and ad-hoc
`notify_send` messages to a configurable webhook URL. Supports
Slack/Discord-compatible JSON endpoints, n8n, ntfy, or any HTTP receiver.

## JSON wire format

Each delivery POSTs JSON with the following top-level keys:

```json
{
  "source": "wrongstack/notify-hub",
  "event": "session.stop",
  "ts": "2026-07-19T10:00:00.000Z",
  "title": "session.stop",
  "message": "…",
  "level": "info",
  "sessionId": null,
  "cwd": null
}
```

### Key changes from the legacy inline format

The legacy format (before the channel-extraction refactor) spread the event
payload directly at the top level:

```json
{ "source": "wrongstack/notify-hub", "event": "session.stop", "ts": "…", "sessionId": null, "cwd": null }
```

The refactored format preserves all original payload keys via `metadata`,
which is spread into the JSON body. Key differences:

| Aspect | Legacy (inline) | Refactored (channel) |
|--------|-----------------|----------------------|
| **Payload keys** | Spread directly at the top level | Spread via `metadata` (included at the end of the JSON object) |
| **`message` key** | Only if present in payload | Always present — set from `NotificationMessage.body` |
| **`level` key** | Not present | Always present — one of `info`, `warning`, `critical` |
| **`title` key** | Not present | Always present — short event title |

Receivers (Slack, Discord, n8n, ntfy) that matched on the legacy flat shape
should update their parsing to use the new keys.

## Configuration

See the doc comments in `index.ts` for the full config schema.

## Circuit breaker

The plugin stops delivery after `maxConsecutiveFailures` consecutive errors.
The circuit resets on the first successful delivery. When the circuit opens,
a warning is logged and further deliveries return suppressed without an HTTP
call until the circuit closes.
