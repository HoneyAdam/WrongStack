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

### 2026-07-21 — Production capture, frozen call metadata, and the deterministic tier

Closes the "sanitized production-to-fixture capture" and "frozen prompt/model metadata for LLM
runs" items from the previous entry.

- Added four decision-internal events. `brain.llm_call` records EVERY pool target attempted per
  decision — model, provider, attempt index, duration, token usage, truncation, and the failures
  the fallback loop previously swallowed in a bare `catch {}`. `brain.council_vote` /
  `brain.council_resolved` re-emit each seat's observable vote plus the deterministic
  quorum/veto/majority resolution (the data already existed on `CouncilResult` and was discarded
  by the adapter). `brain.tier_transition` records each rung of the ladder and why the chain did
  or did not stop there.
- Added `BrainTraceRecorder`: correlates those events into one JSONL row per decision in its own
  file, deliberately NOT the ledger — per-call rows would evict the bounded decision history that
  `digestFor()` / `failureStreakFor()` scan. Content policy is `none` / `redacted` / `full`, and
  the whole trace is disabled by default: enabling it IS the opt-in for production decision
  content on disk. `none` still records models, timings, tokens, vote ids and quorum/veto.
- Added `brainTraceToEvaluationCase()`, reusing the existing `BrainEvaluationCaseV1` format rather
  than introducing a second one. The observed decision becomes an expectation only under
  `pinObservedDecision` — a captured decision is evidence of what happened, not an assertion that
  it was correct, and freezing it wholesale would bake current bugs into the suite.
- Added decision provenance (`markDecisionTier` / `BrainDecisionTier`) recorded out of band via a
  `WeakMap` keyed on the request object, so the public `BrainDecision` union — compared
  structurally throughout the Brain tests — stays untouched. `brain.decision_*` now carries the
  resolving `tier`, which is what separates deterministic correctness from model variance in
  reports.
- Fixed the token accounting the reports depend on: `CouncilResult.usage` reported hardcoded zeros
  for every seat because the adapter's LLM caller discarded provider usage. `stopReason:
  'max_tokens'` is now surfaced too — a response truncated at the 200-token budget was previously
  turned into a decision silently.

Remaining work: stability sampling across repeated runs, comparison reports between policy
revisions, CI/release thresholds, and curated checked-in adversarial fixture suites.

## Acceptance criteria

- Replay never dispatches, terminates, approves, or mutates external state.
- Exact option-ID behavior is a hard regression gate.
- Reports separate deterministic correctness from model variance.
- Production decision content is excluded unless explicitly sanitized and opted in.
