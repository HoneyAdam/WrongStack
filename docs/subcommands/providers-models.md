# `wstack providers` · `wstack models`

Both commands read the models.dev-backed catalog plus the user's saved provider/model overrides.

## `wstack providers`

| Command | Effect |
|---|---|
| `wstack providers` | List supported provider families and whether a known credential environment variable is present. |
| `wstack providers --all` | Include the broader family set, including unsupported catalog entries. |
| `wstack providers --unsupported` | Show only providers that need an additional implementation/plugin. |

The footer reports the currently configured provider and model. This is a catalog view, not merely a list of entries saved in `config.json`.

## `wstack models`

### Catalog listing

```text
wstack models                         # configured provider
wstack models <provider>
wstack models <provider> --search <term>
wstack models <provider> --page N --per-page N
wstack models refresh
```

Listing resolves configured provider aliases, applies the user's visibility list, and shows context, pricing, and capability hints. `refresh` fetches and rewrites the models.dev cache.

### Visibility controls

| Command | Effect |
|---|---|
| `wstack models hide <provider> <model>` | Remove a catalog model from that provider's visible list. |
| `wstack models show <provider> <model>` | Restore a model to the visible list. |
| `wstack models hidden [provider]` | List hidden catalog models (defaults to the configured provider). |
| `wstack models reset <provider>` | Remove the custom visibility list so catalog defaults apply. |

### Custom model definitions

| Command | Effect |
|---|---|
| `wstack models add <modelId> [flags]` | Add or override a custom model definition. |
| `wstack models remove <modelId>` | Remove a custom definition. |
| `wstack models list` | List custom definitions. |
| `wstack models caps [provider] [model]` | Show resolved capabilities; `capabilities` is an alias for `caps`. |

`models add` accepts provider/name, context/output limits, pricing, and capability flags including `--tools`/`--no-tools`, vision, reasoning, attachment, and temperature controls. Run `wstack models add --help` for the exact current flags.

## Code reference

- `packages/cli/src/subcommands/handlers/providers-models.ts`
- `packages/core/src/models/models-registry.ts`
- `packages/cli/src/provider-helpers.ts` — visibility resolution
