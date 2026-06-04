# 01 — Basic Usage

Getting started with WrongStack.

## Single-shot

Run one task and exit:

```bash
wrongstack "explain what this project does"
wrongstack "list all TypeScript files in src/"
wrongstack "what Node.js version does this project require?"
```

## Interactive REPL

```bash
wrongstack
```

Then type freely:

```
> What framework is this project using?
> Show me the entry point
> Add a comment to the main function explaining what it does
```

## TUI mode

Rich terminal UI with live status bar, streaming text, paste collapse,
and image-from-clipboard:

```bash
wrongstack --tui
```

Use `Alt+V` (or `/image`) inside the TUI to attach the current
clipboard PNG to the next message.

## Session resume

```bash
# List recent sessions for this project
wrongstack sessions

# Resume a specific session (pass the id from the list above)
wrongstack --resume <session-id>

# Or the short sugar form — same effect
wrongstack resume <session-id>
```

## YOLO mode

Auto-approve normal project work for fast iteration. Clearly destructive calls can still ask unless you also start with `--yolo-destructive`:

```bash
wrongstack --tui --yolo "add JSDoc comments to all exported functions in src/"
```

Toggle at runtime from inside the REPL or TUI:

```
/yolo            # show current status
/yolo on         # auto-approve normal project work
/yolo off        # re-enable permission prompts
/yolo toggle     # flip
```

## First-run setup

If you haven't configured a provider yet:

```bash
wrongstack init                      # interactive wizard
wrongstack auth anthropic            # add an encrypted API key for one provider
wrongstack providers                 # list every provider in the models.dev catalog
wrongstack models anthropic          # list models for a specific provider
```
