# API Design — WrongStack (Compact)

Designs and reviews REST APIs for WrongStack services. JSON over HTTPS, conventional HTTP status codes, cursor-based pagination.

## Rules

1. Use conventional HTTP status codes: 200 (ok), 201 (created), 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 500 (server error).
2. Always return consistent error shape: `{ "error": { "code": "ERROR_CODE", "message": "Human readable" } }`.
3. Use plural nouns for resource names: `/sessions` not `/session`.
4. Pagination: cursor-based for large datasets, not offset-based.
5. Request validation: validate on server, return 400 with field-level errors.
6. Idempotency: POST to /resources creates; PUT to /resources/:id replaces.
7. No secrets in URLs — put auth in headers, not query params.
8. Versioning: prefix with `/v1/` when breaking changes are inevitable.

## Error codes

| Code | HTTP | When |
|------|------|------|
| VALIDATION_ERROR | 400 | Request invalid |
| UNAUTHORIZED | 401 | Missing/invalid auth |
| FORBIDDEN | 403 | No permission |
| NOT_FOUND | 404 | Resource missing |
| CONFLICT | 409 | Duplicate |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server failure |