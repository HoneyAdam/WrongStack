# /telegram-setup - Telegram Plugin Setup

Configures the Telegram bridge plugin securely. The bot token is entered at a
**masked prompt** and never appears in slash history, terminal scrollback, or
plaintext config. The command performs a live `getMe` request against the
Telegram API before writing configuration.

Alias: `/tg-setup`.

## Usage

| Command | Effect |
|---|---|
| `/telegram-setup` | Prompt securely for the bot token |
| `/telegram-setup <chatId>` | Prompt securely and save a default chat ID |
| `/telegram-setup help` | Show command help |

> **Security note:** Bot tokens are no longer accepted as slash-command
> arguments. Running `/telegram-setup <token>` will be refused with an
> explanation. Use the masked prompt instead.

## Setup Flow

1. Create a bot with `@BotFather` and copy its token.
2. Message the bot once.
3. Run `/telegram-setup` and paste the token at the masked prompt.
4. The command validates the token via `getMe` and saves it to the encrypted
   vault.
5. (Optional) Run `/telegram-setup <chatId>` to set a default notification
   chat, or use the pairing discovery flow to select from recent identities.
6. Restart WrongStack so the Telegram plugin can load the new settings.

## Pairing Discovery

When no chat ID is provided, setup discovers recent Bot API identities via
bounded `getUpdates` and requires an explicit selection. Group, supergroup,
and channel IDs are excluded from pairing candidates.

## Code Reference

- `packages/cli/src/slash-commands/telegram-setup.ts`
- `packages/cli/src/slash-commands/telegram-pairing.ts`
- `packages/cli/src/settings-menu.ts`
- `packages/telegram/`
