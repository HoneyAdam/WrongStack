# `/model` — Provider/model picker (TUI)

Aliases: `/provider`, `/switch`.

`/model` opens the TUI's two-step picker: first choose a configured provider, then choose one of its available models. The live provider/model changes only after the second step is confirmed.

The command is registered only when the TUI host supplies provider-listing and switching callbacks. It has no positional arguments and is distinct from:

- [`/setmodel`](setmodel.md), which exposes the typed leader and task-matrix controls.
- [`/models`](models.md), which manages custom model definitions.
- [`/modelcaps`](modelcaps.md), which browses catalog capabilities and pricing.

## Code reference

- `packages/tui/src/app.tsx` — official TUI registration
- `packages/tui/src/components/model-picker.tsx` — picker UI
