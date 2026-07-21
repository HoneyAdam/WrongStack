# Test Typecheck Debt Baselines

Each JSON file records normalized diagnostic hashes and occurrence counts for one package test TypeScript project.

The files are generated from `node scripts/check-test-typecheck.mjs --print-baseline` and reviewed package by package. Do not raise a count to make a new error pass without documenting the reason in the refactor task. Resolved diagnostics do not require baseline edits immediately; periodic burn-down changes should remove obsolete hashes.
