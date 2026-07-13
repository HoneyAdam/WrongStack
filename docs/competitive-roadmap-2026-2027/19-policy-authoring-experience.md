# Policy Authoring Experience

**Priority:** P0  
**Horizon:** 1–4 months  
**Status:** In progress

## Outcome

Make path, tool, command, network, and risk policies understandable and safely editable from WebUI and TUI without weakening the existing permission engine.

## Scope

- A versioned, machine-readable policy schema and validator.
- Visual rule builder with ordered allow/confirm/deny rules.
- Scope previews for paths, commands, hosts, tools, and capabilities.
- “Explain this decision” showing the matched rule and precedence.
- Simulation against recorded, redacted tool-call fixtures before saving.
- Import/export and guarded migration for existing trust files.

## Delivery plan

1. Extract canonical policy schema, diagnostics, and decision explanation.
2. Add a read-only policy inspector and simulator.
3. Add WebUI rule editing with atomic validation/save.
4. Add a compact TUI editor or guided command flow.
5. Add conflict, shadowed-rule, and over-broad-rule linting.

## Implementation progress

### 2026-07-12 — Canonical schema, diagnostics, and runtime enforcement

- Added one machine-readable JSON Schema and one runtime validator for the existing `trust.json`
  model; no second policy evaluator or incompatible file format was introduced.
- Validation covers tool/rule limits, known fields, booleans, bounded non-empty patterns,
  duplicate normalization, and reserved object-property names. Diagnostics include stable codes,
  paths, severity, and messages suitable for future WebUI/TUI inspectors.
- `DefaultPermissionPolicy` now consumes the same validator and exposes read-only diagnostics.
  Missing files remain a valid empty policy, while malformed JSON, invalid rule shapes, and read
  failures fail closed even in YOLO mode.
- Runtime mutation refuses to overwrite an invalid policy, preserving the original file for
  operator repair. Added schema, normalization, prototype-name, malformed-input, YOLO fail-closed,
  persistence-preservation, and missing-file regression coverage.

Remaining work: decision explanation with matched-rule precedence, a no-write simulator, shadowed
and over-broad rule linting, audited atomic editing, guarded migrations/import-export, and WebUI/TUI
authoring surfaces.

## Acceptance criteria

- The UI serializes the same policy model consumed by the runtime; no second evaluator exists.
- Invalid or broader-than-intended changes show a diff and cannot save silently.
- Policy edits are audited and recoverable.
- Project-controlled configuration cannot add privileged policy sources.
