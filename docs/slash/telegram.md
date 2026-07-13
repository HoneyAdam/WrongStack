# Telegram plugin slash commands

The opt-in `telegram` plugin registers three commands when its bot starts successfully.

| Bare command | Aliases | Namespaced form | Effect |
|---|---|---|---|
| `/telegram-health` | `/telegram`, `/tgstat`, `/tgs` | `/telegram:telegram-health` | Show bot health, polling state, allowlists, and notification settings. |
| `/send [chat_id] <message>` | — | `/telegram:send` | Send a message. A numeric first argument overrides the configured default chat. |
| `/chatid` | — | `/telegram:chatid` | Show the configured default notification chat id. |

If `/send` receives no numeric chat id, it uses `notifyChatId`. It returns usage instead of sending when neither is available. The namespaced forms avoid collisions with other official plugins or core commands.

These runtime commands are separate from the always-registered [`/telegram-setup`](telegram-setup.md) and [`/telegram-settings`](telegram-settings.md) CLI commands.

## Code reference

- `packages/telegram/src/slash-commands/index.ts`
- `packages/telegram/src/index.ts` — plugin setup and teardown
