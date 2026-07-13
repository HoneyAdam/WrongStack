# `/steer` — Interrupt and redirect (TUI)

```text
/steer <new direction>
```

`/steer` performs the TUI's steering sequence: capture what was in flight, abort the active leader iteration, terminate running fleet agents, discard queued messages, and send the supplied text as the next model turn with a `STEERING` preamble. The response reports how many queued messages and subagents were stopped.

With no text, the command prints its usage and changes nothing. It can also be invoked while idle; abort and termination then become no-ops, but the steering preamble is still sent.

This command is mounted by the TUI. It is the typed equivalent of pressing **Esc** and entering a replacement direction.

## Code reference

- `packages/tui/src/app.tsx` — `/steer` registration and `runSteerSequence()`
