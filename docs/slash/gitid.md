# `/gitid` — Agent commit identity

Configure the author identity inherited by Git processes that WrongStack starts. This does not rewrite the repository's own Git configuration.

| Command | Effect |
|---|---|
| `/gitid` | Show the active identity and whether it is persisted. |
| `/gitid set <name...> <email>` | Apply and persist an identity in the global WrongStack config. |
| `/gitid set <name...> <email> --session` | Apply it only to the current process and its children. |
| `/gitid clear` | Remove the persisted override and return to normal Git config. |
| `/gitid clear --session` | Clear only the live process override. |
| `/gitid help` | Show command help. |

The email must be the final positional argument. When no override is active, commits use the normal `user.name` and `user.email` resolved by Git.

## Code reference

- `packages/cli/src/slash-commands/gitid.ts`
- `packages/core/src/utils/child-env.ts` — child-process environment override
