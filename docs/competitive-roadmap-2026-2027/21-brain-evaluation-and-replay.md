# Brain Evaluation and Replay

**Priority:** P0  
**Horizon:** 1–4 months  
**Status:** Proposed

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

## Acceptance criteria

- Replay never dispatches, terminates, approves, or mutates external state.
- Exact option-ID behavior is a hard regression gate.
- Reports separate deterministic correctness from model variance.
- Production decision content is excluded unless explicitly sanitized and opted in.

