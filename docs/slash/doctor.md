# /doctor - Config Doctor

## What It Does

`/doctor` diagnoses the persisted config files — the global
`~/.wrongstack/config.json` and, when present, the per-project config — and
`/doctor fix` repairs everything that can be fixed deterministically.

Bare `/doctor` is strictly read-only: it prints a findings list (errors,
warnings, which ones are auto-fixable) and touches nothing.

## Checks

| Check | Auto-fix |
|---|---|
| Invalid JSON (corrupt file) | Restore from `config.json.last` or the newest parsable `*.bak`; corrupt original kept as `*.broken.bak` |
| Boolean fields (`hints`, `debugStream`, `yolo`, `nextPrediction`) | Coerce `"true"`/`"on"`/`1` etc.; otherwise remove so the built-in default applies |
| `configScope`, `autonomy.defaultMode`, `autonomy.enhanceLanguage` enums | Remove invalid values (defaults apply) |
| `maxConcurrent`, autonomy delay fields | Coerce numeric strings, clamp negatives, floor non-integers |
| `version` | Reset to `1` |
| `plugins` array shape | Drop malformed entries, coerce `enabled`, keep valid ones |
| `extensions` sections | Drop non-object sections; validate each section against the owning builtin plugin's `configSchema` and remove invalid options (plugin `defaultConfig` fills the gap at load) |
| Unknown top-level keys | Case-typos renamed to the known key (`debugstream` → `debugStream`); truly unknown keys are warned about but never deleted |
| Plaintext secrets (`apiKey`-style fields without the `enc:v1:` vault prefix) | Warning only — encrypted on next boot, never rewritten by the doctor |
| Credential fields in the project config | Warning only (`filterSafeForProject` would refuse them; move them to the global config) |
| `provider` / `model` wrong type | Reported, not guessed — set manually via `/models` |

## Usage

| Usage | Effect |
|---|---|
| `/doctor` | Diagnose both config files, read-only |
| `/doctor fix` | Apply all auto-fixes (backs up first) |

## Fix Safety

- Every write is preceded by a backup using the config-history naming
  convention: `config.json.last` plus a timestamped `config.json.<ts>.bak`.
- Fixes prefer **removal over guessing**: built-in defaults (and plugin
  `defaultConfig`) are merged underneath user values at load time, so deleting
  an invalid value falls back to a known-good default. Values are only
  rewritten when the intent is unambiguous (e.g. `"true"` → `true`).
- Global-config fixes are mirrored into the in-memory config store and appear
  in `/config-history`, so they take effect without a restart.

## Code Reference

- `packages/cli/src/config-doctor.ts` — pure diagnose/fix engine
- `packages/cli/src/slash-commands/doctor.ts` — the command (file IO, backups)
- `packages/cli/src/config-history.ts` — backup/restore conventions reused here
