# Browser-Aware E2E Runner

WrongStack's first E2E runner slice is the read-only `e2e_plan` tool. It discovers Playwright and
Cypress projects before any server or test process is started.

The plan reports:

- authoritative config and package paths;
- framework dependencies and matching package scripts;
- package manager and exact command/argument arrays;
- statically readable managed-server or attach URL hints;
- bounded spec counts and samples;
- dynamic configuration values that require runtime confirmation.

Discovery never imports or evaluates project configuration. This matters because Playwright and
Cypress config files are executable code. Directories such as dependencies, build output, coverage,
and existing test artifacts are skipped, scans and samples are capped, and cancellation is checked
throughout traversal.

Example:

```text
e2e_plan { "framework": "playwright" }
```

The returned argv is advisory. Process-registry-backed server startup, execution, normalized
failure artifacts, and evidence viewers are later roadmap slices and remain permission-gated.
