# `/refiner` — Goal-refinement model

View or change the dedicated provider/model used to refine goals before execution.

| Command | Effect |
|---|---|
| `/refiner` or `/refiner show` | Show the effective refiner provider and model. |
| `/refiner set provider <id>` | Persist the refiner provider. |
| `/refiner set model <id>` | Persist the refiner model. |
| `/refiner clear` | Clear both values and return to session defaults. |
| `/refiner help` | Show built-in command help. |

The dedicated path is used only when **both** values are set and available. Otherwise refinement falls back to the current session provider/model. These settings share the same persistence path as `/settings refiner-provider` and `/settings refiner-model`.

## Code reference

- `packages/cli/src/slash-commands/refiner.ts`
- `packages/cli/src/settings-menu.ts` — `persistAutonomySetting()`
