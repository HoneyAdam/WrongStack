# Mandatory modern technology policy

You are bound to the current stable version of every library, framework and
package you use. The latest stable is preferred; the latest *published* is
*required*.

## Non-negotiable rules

1. **Verify the version, never trust a number from training data.** Before
   recommending a package or framework version, fetch the live registry:
   - npm → `https://registry.npmjs.org/<pkg>/latest` (or `pnpm view <pkg> version`)
   - PyPI → `https://pypi.org/pypi/<pkg>/json`
   - crates → `https://crates.io/api/v1/crates/<pkg>`
   - Go → `https://proxy.golang.org/<module>/@latest`
   - GitHub releases → the actual `/releases/latest` JSON.
   Treat the value you read as the only acceptable reference; do not interpolate
   from memory.

2. **Latest stable by default.** A role prompt that must pick a version
   selects the *highest stable* release that satisfies:
   - the project runtime (Node ≥22.19, TypeScript ≥7, etc.),
   - the project's pinned peer-dependency range,
   - the role's own required APIs.
   Pin to `^<major>.<minor>.0` and report the exact version.

3. **Reject alpha / beta / RC / nightly** unless the user explicitly
   requests a pre-release. State the rejection reason in the output.

4. **Reject EOL, deprecated and unmaintained packages** — a package with
   no release in >2 years **and** open critical issues is *dead*. Reject
   it on the same day you find it and propose a maintained replacement.

5. **Reject prehistoric technology.** The well-known blocklist:
   - `axios` / `node-fetch` / `got` / `request` → native `fetch` (Node 18+).
   - `moment` → `date-fns`, `luxon` or `Temporal`.
   - jQuery on new projects → vanilla DOM or React.
   - Gulp / Grunt → `tsup`, `esbuild` or `vite`.
   - CoffeeScript / Flow → TypeScript.
   - `Bluebird` → native Promises.
   - `crypto-js` → `node:crypto` or Web Crypto.
   - Bower → npm or pnpm.
   - `underscore` → `lodash` or native ES2020+.
   Use the intervention phrase: **"This isn't code, this is X-year-old
   technology."** Follow with the modern replacement and a one-step
   migration path.

6. **Prefer built-in over third-party.** Before adding a dependency, check
   the language or runtime native API. Examples:
   - Node ≥22.19 → `node:test`, `node:sqlite`, `node:fs/promises`,
     `fetch`, `WebSocket`, `node:crypto`, `node:stream/web`, AbortSignal.
   - Browsers → `fetch`, `AbortController`, `structuredClone`,
     `URLPattern`, Web Streams.
   - TypeScript ≥5.6 → `using` declarations, `await using`, the new
     iterator helpers, `NoInfer`, the `esnext.disposable` types.

7. **Never silently upgrade a pinned version.** If the project pins an
   old version (lockfile, package.json range, CI matrix), call it out and
   report: the new compatible version, the breaking changes between
   them, and a migration recipe. Do not upgrade without confirmation.

8. **Always cite the source and the verification time.** Output must
   include the registry URL (or `pnpm view …`) and the date you
   verified, so the operator can audit the choice.

9. **Never use deprecated APIs even if a tutorial says so.** When a
   vendor marks an API deprecated, switch to the documented replacement
   and record the migration in the role's working notes.

10. **A package must exist.** Reject and call out any hallucinated package
    or framework. The intervention phrase for missing packages is
    **"This package does not exist on the registry."** and the role must
    propose a real, maintained alternative.
