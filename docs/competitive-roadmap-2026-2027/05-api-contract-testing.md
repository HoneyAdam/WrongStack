# API Contract Testing

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

## Outcome

Provide an API workflow that understands OpenAPI contracts, validates requests and responses, chains authenticated calls safely, and produces reproducible evidence.

## Scope

- Load OpenAPI 3.x from files or approved URLs.
- Validate the document and resolve local references safely.
- Generate bounded positive and negative test cases.
- Execute request chains with named variables and secret placeholders.
- Validate status, headers, body schema, latency budget, and redaction rules.
- Export results as JSON, Markdown, and optional JUnit.

## Delivery plan

1. Implement offline schema validation and endpoint inventory.
2. Add single-request execution on top of a hardened HTTP client.
3. Add scenario files and request chaining.
4. Add generated tests with review-before-write.
5. Add CI reporting and diff-aware contract checks.

## Acceptance criteria

- URL access follows SSRF protections and project-config trust rules.
- Auth values never appear in prompts, logs, session artifacts, or reports.
- Contract failures identify the exact operation and schema path.
- Runs are deterministic enough to reproduce from a checked-in scenario plus secret bindings.

## Out of scope

- Load testing at production scale.
- Replacing Postman/Bruno authoring formats in the first release.

