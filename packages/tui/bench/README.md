# TUI heap-soak benchmark

This benchmark measures the retained heap of the production Ink `ScrollableHistory` renderer under a deterministic growing transcript at narrow and wide terminal widths.

Run the controlled profile:

```bash
pnpm bench:tui-heap
```

Run a smaller end-to-end smoke profile (it still writes and analyzes heap snapshots):

```bash
pnpm bench:tui-heap --quick
```

Artifacts are written to `.reports/tui-heap-soak/`:

- `width-<n>.json` — post-GC checkpoints, plateau slope, render timing, and mounted Ink/text/Yoga counts.
- `width-<n>-mounted.heapsnapshot` — retained heap with the renderer mounted.
- `width-<n>-unmounted.heapsnapshot` — retained heap after renderer teardown.
- `width-<n>-dominators.json` — exact immediate-dominator retained-size reports for both snapshots.
- `report.json` and `report.md` — narrow/wide aggregate comparison.

The command bundles workers into `.temp_files/tui-heap-soak/`, runs each width in a fresh `node --expose-gc` process, analyzes snapshots only after the renderer process exits, and deletes the temporary bundles in `finally`.

Useful overrides:

```bash
pnpm bench:tui-heap --entries 5000 --steps 30 --plateau-samples 12 --widths 64,200
```

Compare post-GC plateau slope and top mounted/unmounted dominators rather than one RSS sample. A healthy bounded renderer should approach a stable post-GC heap after the transcript and viewport reach steady state.
