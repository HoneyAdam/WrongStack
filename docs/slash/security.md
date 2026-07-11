# /security — Security diagnostics

Interactive security checks for the current project: dependency audit,
bug-hunter scan dispatch, and a secret-redaction dry run.

## Subcommands

| Command | Effect |
|---|---|
| `/security audit-deps` | Run `pnpm audit --json` in the project and print a severity summary (critical/high/moderate/low + total). |
| `/security scan` | Print dispatch instructions for a `bug-hunter` subagent scan of the cwd. |
| `/security redact-test` | Run `DefaultSecretScrubber` over a sample payload with known secret shapes and report exactly which fields were redacted. |
| `/security help` | Usage help (also the default with no subcommand). |

Append `--json` to any subcommand for stable machine-readable output and
slash-command metadata at `metadata.security`.

## audit-deps

Spawns `pnpm audit` with a 60 s timeout. A non-zero pnpm exit is normal when
vulnerabilities exist — the summary is parsed from the JSON output either
way.

## scan

Slash commands are a synchronous UI surface and cannot host a subagent
themselves, so `scan` prints how to dispatch the `bug-hunter` role from a
director-capable surface. In the TUI, run `/director` first if needed, then use
`/delegate --role=bug-hunter "Run a security scan of the current project"` or
`/fleet dispatch Run a security scan of the current project`. HQ can start the
same role from Control → Spawn role → `bug-hunter`. Findings stream on the
FleetBus as `bug.found` events and land in the audit log.

## redact-test

Proves the log-redaction pipeline works end-to-end: the sample contains API
keys, tokens, connection strings with passwords, and bearer JWTs, plus
non-sensitive fields. The output lists each redacted field with its
before/after value and counts the fields that passed through unchanged. If
nothing is redacted, the scrubber is not wired correctly — that is called
out explicitly.

The JSON form contains only redacted field paths and counts; it never includes
the synthetic before-values used by the human-readable demonstration.

## Structured output

- `audit-deps --json` returns exit status, clean state, and severity counts.
- `scan --json` returns portable CLI, fleet, and HQ dispatch instructions
  without the project path.
- `redact-test --json` returns redacted/unchanged field paths and counts without
  secret-shaped values.
- Unknown subcommands return `ok: false` with a stable error code.

## Examples

```
/security audit-deps
/security audit-deps --json
/security redact-test
```

See also: `/audit` (side-effect trail), `/delegate`, `/fleet dispatch`, and
SECURITY.md for the project's security policy.
