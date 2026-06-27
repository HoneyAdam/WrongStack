# /prompts - Personal Prompt Library

Registered by the built-in `wstack-prompts` plugin. Stores reusable prompts in
the project/user prompt store and can ask the active LLM provider to extend an
existing prompt.

## Usage

| Command | Effect |
|---|---|
| `/prompts` | List stored prompts |
| `/prompts list` | Same as `/prompts` |
| `/prompts ls` | Alias for `list` |
| `/prompts view <title>` | Show the best matching prompt |
| `/prompts show <title>` | Alias for `view` |
| `/prompts add "title" "content"` | Add a prompt |
| `/prompts add --category <c> --description "<d>" --tags <a,b> --var <name:desc> "title" "content"` | Add with structured fields + `{{variables}}` |
| `/prompts new "title" "content"` | Alias for `add` |
| `/prompts favorite <slug-or-title>` | Mark a prompt favorite (copies a builtin into your user layer) |
| `/prompts delete <title>` | Delete the best matching prompt |
| `/prompts rm <title>` | Alias for `delete` |
| `/prompts edit "title" "new content"` | Replace prompt content |
| `/prompts update "title" "new content"` | Alias for `edit` |
| `/prompts extend "title" <instructions>` | Use the active LLM provider to improve an existing prompt |

## Code Reference

- `packages/core/src/plugins/prompts-plugin.ts`
- `packages/core/src/storage/prompt-store.ts`
