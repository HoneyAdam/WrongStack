# Public Benchmark Transparency

**Priority:** P1  
**Horizon:** 2–6 months  
**Status:** Proposed

## Outcome

Publish reproducible WrongStack results using the existing Aider Polyglot and SWE-bench harness, then evaluate Terminal-Bench support without making unverifiable marketing claims.

## Scope

- Versioned benchmark profiles for model, provider, prompts, tools, autonomy, budget, and retries.
- Immutable harness fingerprint, dataset/subset digest, environment image, and WrongStack commit.
- Accuracy, pass rate, cost, tokens, latency, retries, and failure taxonomy.
- Raw machine-readable results plus a generated human report.
- Scheduled and release-candidate runs with comparable history.
- A feasibility spike for Terminal-Bench after existing suites are stable.

## Delivery plan

1. Reproduce a small pinned Polyglot and SWE-bench subset in CI-like infrastructure.
2. Add artifact signing, schema validation, and result publication.
3. Run repeated trials and document variance.
4. Publish a static leaderboard/methodology page.
5. Add full suites and Terminal-Bench only after cost and isolation controls are proven.

## Acceptance criteria

- Every published score can be reproduced from public configuration and pinned inputs, excluding provider credentials.
- Failed and invalid runs remain visible; cherry-picking is prevented by policy and metadata.
- Comparisons disclose model versions, dates, costs, and non-default settings.
- Benchmark environments cannot access maintainers' workspaces or secrets.

