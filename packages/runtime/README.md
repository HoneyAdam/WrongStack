# @wrongstack/runtime

Host composition and platform adapters for WrongStack.

`@wrongstack/runtime` owns container composition, canonical host-tool
registration, image routing, clipboard access, the local-model probe, and
light-subagent assembly. These are real implementations, not aliases.

Core defaults are intentionally not re-exported. Import their declared Core
subpaths directly. The R4 observability pilot proved that moving a Core-owned
implementation here while retaining Core compatibility would create the
`Core -> Runtime -> Core` package cycle prohibited by ADR-004.

```ts
import { createDefaultContainer } from '@wrongstack/runtime';
import { DefaultTokenCounter } from '@wrongstack/core/infrastructure';
```

The `WrongStackPack` interface in `@wrongstack/runtime/pack` is the target shape
for extension packages that contribute tools, providers, slash commands, or
agent lifecycle extensions.

## Image routing

`@wrongstack/runtime/vision` owns the host-level image input decision:

- if the active provider reports `capabilities.vision`, image blocks are sent
  natively;
- otherwise, the host can provide `VisionAdapter`s that turn images into text
  descriptions before `agent.run()`;
- if neither route exists, the router throws a clear unsupported-image error
  instead of silently flattening the image to `[image]`.

`createToolVisionAdapters(toolRegistry)` can discover safe, read-only
image-understanding tools, including MCP-wrapped tools, and expose them through
the same adapter contract. Built-in MCP presets such as `zai-vision` and
`minimax-vision` are configured as read-only adapter candidates. Hosts may pass
a function that calls `createToolVisionAdapters()` at routing time so MCP
reconnects and `tools/list_changed` refreshes are picked up before each image
is analyzed.

`@wrongstack/runtime/clipboard` exposes the shared OS clipboard PNG reader used
by TUI `Alt+V` and CLI `/image`.
