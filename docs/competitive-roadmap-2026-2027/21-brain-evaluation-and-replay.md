# Brain Evaluation and Replay

**Priority:** P0  
**Horizon:** 1–4 months  
**Status:** In progress

## Outcome

Measure and improve Brain decision quality with deterministic fixtures, exact-option validation, replay, policy comparison, and regression gates.

## Scope

- A versioned evaluation case format containing redacted context, options, expected constraints, and allowed decisions.
- Offline replay of deterministic and LLM tiers without executing the resulting action.
- Metrics for valid-option rate, unsafe allowance, unnecessary escalation, latency, cost, and stability.
- Decision trace showing tier outcomes, policy ceiling, selected option ID, and rationale.
- Curated adversarial cases for negation, option ambiguity, prompt injection, stale fleet state, and partial failure.

## Delivery plan

1. Capture sanitized decisions into replay fixtures.
2. Build deterministic policy and parser regression suites.
3. Add LLM eval runner with frozen prompts/model metadata.
4. Add comparison reports and release thresholds.
5. Use failures to add focused examples and policy rules, not broad prompt growth.

## Implementation progress

### 2026-07-12 — Offline fixture and deterministic evaluation foundation

- Added a versioned, JSON-serializable evaluation case format with runtime validation for request
  shape, unique option IDs, exact expected IDs, escalation policy, and unsafe-option constraints.
- Added an offline runner that accepts any Brain arbiter, clones fixture input, records decisions,
  and exposes no action dispatch, termination, permission, or tool-execution callback.
- Added per-case diagnostics plus pass rate, exact-option validity, unsafe allowance, unnecessary
  escalation, error, and latency metrics. Invalid fixtures and duplicate case IDs never reach the
  arbiter.
- Added deterministic policy, invalid/unsafe option, escalation, arbiter failure, mutation
  isolation, and fixture-validation regression tests. This builds on the existing production
  exact-option parser and `BrainDecisionLedger` rather than introducing a second decision parser.

Remaining work: explicit sanitized production-to-fixture capture, frozen prompt/model metadata for
LLM runs, stability sampling, comparison reports, CI/release thresholds, and curated checked-in
adversarial fixture suites.

## Acceptance criteria

- Replay never dispatches, terminates, approves, or mutates external state.
- Exact option-ID behavior is a hard regression gate.
- Reports separate deterministic correctness from model variance.
- Production decision content is excluded unless explicitly sanitized and opted in.
