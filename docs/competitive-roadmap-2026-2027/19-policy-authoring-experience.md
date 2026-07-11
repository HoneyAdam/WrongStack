# Policy Authoring Experience

**Priority:** P0  
**Horizon:** 1–4 months  
**Status:** Proposed

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

## Acceptance criteria

- The UI serializes the same policy model consumed by the runtime; no second evaluator exists.
- Invalid or broader-than-intended changes show a diff and cannot save silently.
- Policy edits are audited and recoverable.
- Project-controlled configuration cannot add privileged policy sources.

