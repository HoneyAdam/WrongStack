# /security — Security scanner

The CLI command is a thin adapter over `@wrongstack/security-scanner`. It runs
the real source scanner, dependency audit, report reader, and secret-redaction
diagnostic for the current project.

## Subcommands

| Command | Effect |
|---|---|
| `/security scan [--depth ...] [--format ...]` | Run the LLM-assisted source security pipeline and write a report. |
| `/security audit` | Run the package-manager audit, then run the source scan when an LLM provider is active. |
| `/security audit-deps` | Run only the detected npm/pnpm/yarn dependency audit. |
| `/security report [id]` | List or read reports under `<project>/security-reports`. |
| `/security redact-test` | Exercise the production secret scrubber with synthetic values; output contains field names only. |
| `/security help` | Show usage help. |

`scan` requires an active LLM provider. `audit-deps` remains useful without
one. Supported scan depths are `quick`, `standard`, and `deep`; report formats
are `markdown`, `json`, and `html`.

Append `--json` for stable CLI adapter output in `metadata.security`.

## Examples

```text
/security scan --depth deep --format html
/security audit
/security audit-deps --json
/security report
/security redact-test --json
```

The former `wstack-security` no-op plugin was retired. There is one production
command path: CLI adapter → `@wrongstack/security-scanner`.
