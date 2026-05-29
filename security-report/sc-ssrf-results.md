# SSRF / Open-Redirect / Outbound-Request Audit — WrongStack

Scope: `packages/tools/src/fetch.ts`, `search.ts`; `packages/mcp/src/transport.ts`;
`packages/telegram/src/bot.ts`; `packages/plugins/src/web-search/index.ts`;
`packages/core/src/skills/github-fetcher.ts`; `packages/cli/src/update-check.ts`.

Method: read-only review + a small local Node check of WHATWG `URL` hostname
normalization (`node -e ...`) to validate the octal/hex/decimal-IP claims in
fetch.ts. No source files modified.

---

## Verdict on the fetch.ts SSRF guard

The fetch.ts guard is **largely sound for literal-IP and scheme attacks**, and
notably **stronger than typical implementations** because it re-validates on
every redirect hop. It has **one real, self-documented residual gap (DNS
rebinding / TOCTOU)** that the authors explicitly flagged and accepted for
single-tenant use. The decimal/octal/hex/IPv4-mapped/trailing-dot "bypasses"
listed in the brief are **NOT exploitable here** — see finding SSRF-05 (a
negative/clean result), validated empirically.

---

## SSRF-01 — DNS-rebinding / TOCTOU: hostname checked, resolved IP not pinned (CONFIRMED)

- Severity: Medium (Low in the intended single-tenant/operator-trust model; the
  code self-classifies it as "accepted risk").
- CWE: CWE-918 (SSRF), CWE-367 (TOCTOU race).
- File:line: `packages/tools/src/fetch.ts:200-220` (the `dns.lookup` branch in
  `assertNotPrivate`), connect site `fetch.ts:46` and `fetch.ts:115`.
- Evidence:
  ```ts
  // fetch.ts:208-219
  const records = await dns.lookup(host, { all: true });
  for (const r of records) {
    const bad = r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address);
    if (bad) throw new Error(`fetch: resolved to private address ${r.address}`);
  }
  ```
  The guard resolves DNS, validates the records, then **discards them** and calls
  `fetch(currentUrl, ...)` (fetch.ts:46), which performs its **own, second** DNS
  resolution. The validated IP is never pinned to the connection.
- Scenario: Attacker controls a DNS name (or LLM is steered to one). Their
  resolver returns a public IP for the guard's `dns.lookup`, then `169.254.169.254`
  (cloud IMDS) / `127.0.0.1` for the subsequent `fetch()` connection. Classic
  rebinding; also triggerable with a low-TTL round-robin that happens to flip.
- Exploitability: Requires attacker-controlled DNS or a race; `fetch` is
  `permission: 'confirm'`, so a human approves the literal URL first — but the URL
  shown looks benign (a public hostname), so confirmation does not mitigate
  rebinding. The window is real because there are two independent resolutions.
- The code already documents this exactly (fetch.ts:200-207) and proposes the
  correct fix.
- Remediation: Pin the resolved IP. Use a custom `undici` `Agent` with a
  `connect` option (or `lookup` callback) that resolves the host once, validates,
  and reuses that single address for the socket — so the validated IP is the
  connected IP. Re-create/re-validate the agent per redirect hop.

---

## SSRF-02 — web-search plugin `web_fetch`: no DNS resolution, incomplete IP range list, no redirect re-validation (CONFIRMED)

- Severity: Medium.
- CWE: CWE-918.
- File:line: `packages/plugins/src/web-search/index.ts:74-96` (`assertSafeUrl`),
  used at `index.ts:99` (`fetchUrl`) → `fetch` at `index.ts:100`.
- Evidence / gaps vs fetch.ts:
  1. **No DNS resolution at all** — only literal-IP hosts are checked
     (`isIPv4(host)` at index.ts:85). Any hostname (e.g. an internal DNS name,
     or a public name that resolves to a private IP) sails straight through.
     Comment at index.ts:69-73 acknowledges this ("without DNS resolution").
  2. **No IPv6 private-range check** — `isIPv6` is imported (index.ts:9) but
     `assertSafeUrl` never calls it. `http://[::1]/`, `http://[fd00::1]/`, and
     IPv4-mapped `http://[::ffff:169.254.169.254]/` are **not blocked** (the
     `::1` literal is not in the localhost string check; only `localhost`,
     `*.localhost`, `0.0.0.0` strings are).
  3. **Missing IPv4 ranges**: no `100.64.0.0/10` (CGNAT) and no `192.0.0.0/24`
     that fetch.ts blocks (index.ts:88-92). Minor.
  4. **No redirect re-validation** — `fetch` here uses default
     `redirect: 'follow'`; a `302` to `http://169.254.169.254/` or
     `http://[::1]/` is followed with no second check. (fetch.ts solves this with
     `redirect: 'manual'` + per-hop re-check; this plugin does not.)
  5. **http:// allowed** with no opt-in gate (index.ts:76, :284) — fetch.ts
     requires HTTPS by default.
- Scenario: `web_fetch(url: "http://[::1]:6379/...")` or a public hostname whose
  A record points at `169.254.169.254`, or a public URL that 302-redirects to
  IMDS. All reach `fetch()`.
- Exploitability: `web_fetch` is `permission: 'confirm'` (index.ts:274), so a
  human sees the first URL. But IPv6-loopback/ULA literals and redirect-based
  pivots are not obvious at confirm time, and the LLM chooses the URL. This is an
  LLM/attacker-influenced sink, so Medium.
- Remediation: Reuse fetch.ts's `assertNotPrivate` (resolve + check all records,
  IPv6 ranges, `::1`), set `redirect: 'manual'` and re-validate each hop, and
  default to HTTPS. Best: extract fetch.ts's guard into a shared helper and call
  it from both. Note `web_search` (index.ts:178, `permission: 'auto'`) only hits
  fixed DuckDuckGo URLs — low risk.

---

## SSRF-03 — MCP transport guard is allowlist-permissive by design; IPv6 IMDS/loopback and hostnames not covered (SUSPECTED / low risk by trust model)

- Severity: Low (operator-configured surface).
- CWE: CWE-918.
- File:line: `packages/mcp/src/transport.ts:40-77` (`validateTransportUrl`),
  called from constructors `transport.ts:266` and `transport.ts:577`.
- Evidence:
  - `transport.ts:57-64`: `localhost`/`0.0.0.0`/`::`/`[::1]` are explicitly
    **allowed** (`return;`) — intentional, MCP servers are usually local.
  - Only blocks IPv4 `169.254.x.x` (transport.ts:68-76). No IPv6 link-local
    (`fe80::`), no IPv6-mapped IMDS (`[::ffff:169.254.169.254]`), no DNS
    resolution, no redirect handling (fetch default is `follow` here too).
  - `buildSSEUrl` (transport.ts:431-439) and `postRaw` session-append
    (transport.ts:718-720) mutate the URL but do not re-validate — fine, since
    only the host/scheme matter and those are unchanged.
- Scenario: A malicious or mistaken MCP config entry pointing at an internal
  IPv6 service or an IMDS endpoint via IPv6/DNS would not be blocked.
- Exploitability: **Low — these URLs are admin/operator-configured**, not
  LLM- or attacker-supplied at runtime (confirmed: URL comes from
  `HttpTransportOptions.url` set at registration). The guard's own doc-comment
  (transport.ts:30-39) states this is intentional defense-in-depth, not a
  trust boundary. Reasonable as-is.
- Remediation (optional hardening): add IPv6 IMDS/link-local literals to the
  block list for parity. Not required given the trust model.

---

## SSRF-04 — Operator-fixed outbound endpoints: telegram, npm update-check, github tarball (CLEAN / low risk — documented for completeness)

- `packages/telegram/src/bot.ts:105,183,224,248` — all requests go to the fixed
  `https://api.telegram.org/bot<token>` base URL built from operator config
  (bot.ts:105). Host is not attacker/LLM-controllable. `chat_id`/`text` are body
  params, not URL host. **No SSRF.** (Token redaction helper present at bot.ts:8.)
  HTTPS hardcoded.
- `packages/cli/src/update-check.ts:91` — fixed
  `https://registry.npmjs.org/wrongstack/latest`, no user input in URL, 3s
  timeout, HTTPS. **No SSRF / no open redirect** (fetch default follow is to a
  trusted registry host only).
- `packages/core/src/skills/github-fetcher.ts:50-58` — URL is
  `https://api.github.com/repos/<owner>/<repo>/tarball/<ref>` where
  owner/repo/ref come from `parseSkillRef` (github-fetcher.ts:18-35). `redirect:
  'follow'` is used (github-fetcher.ts:57) — GitHub legitimately 302s tarballs to
  `codeload.github.com`/S3. Host is pinned to `api.github.com` at request time;
  owner/repo are path segments only (a `/` in them just changes the path, cannot
  change host because they are interpolated after the fixed origin and `new URL`
  is not reparsed). **Low risk.** Minor note: no explicit private-IP guard, but
  the origin is a fixed public host and only path is user-influenced, so no SSRF
  pivot. (Separately, `extractTar` skips symlinks/specials — good — though path
  traversal via `..` is only loosely guarded; out of scope for SSRF.)

---

## SSRF-05 — Decimal/octal/hex/IPv4-mapped/trailing-dot encodings do NOT bypass fetch.ts (CONFIRMED CLEAN — avoids a false positive)

- File:line: `packages/tools/src/fetch.ts:99` (`new URL(input.url)`),
  `fetch.ts:190` (`net.isIP`), `fetch.ts:223-241`, `fetch.ts:243-274`.
- Empirically validated locally (`node -e`): WHATWG `URL` **normalizes** all of
  these to canonical form before `assertNotPrivate` ever sees the hostname:
  - `http://0x7f.0.0.1/` → hostname `127.0.0.1` (isIP=4) → blocked.
  - `http://0177.0.0.1/` → `127.0.0.1` → blocked.
  - `http://2130706433/` (decimal) → `127.0.0.1` → blocked.
  - `http://0x7f000001/` → `127.0.0.1` → blocked.
  - `http://127.0.0.1./` (trailing dot) → `127.0.0.1` → blocked.
  - `http://[::ffff:127.0.0.1]/` → `[::ffff:7f00:1]` → handled by the
    IPv4-mapped branch (fetch.ts:255-268) → blocked.
  So the fetch.ts comment at fetch.ts:224-225 ("net.isIP rejects octal/hex/decimal
  forms, so when isIP===4 we know it's canonical") is **accurate**, because the
  earlier `new URL()` already canonicalized the input. Scheme allowlist
  (https/http only, fetch.ts:100-105 and per-hop fetch.ts:38-43) correctly blocks
  `file:`/`gopher:`/`ftp:`/`data:`. Userinfo `user@host` tricks are neutralized —
  `URL.hostname` excludes userinfo.
- Strengths worth recording: per-hop re-validation on redirects with
  `redirect: 'manual'` (fetch.ts:34-63) is the correct pattern and defeats the
  "302 → 169.254.169.254" open-redirect/SSRF pivot for the literal-IP case;
  fail-closed defaults (`expandIPv6` returns `null` → treated as private,
  fetch.ts:251; defensive `true` on malformed IPv4, fetch.ts:228); broad IPv4
  ranges incl. `0/8`, `127/8`, `169.254/16` IMDS, `10/8`, `172.16/12`,
  `192.168/16`, `100.64/10` CGNAT, `224/4`+ ; IPv6 `::`, `::1`, `fc00::/7`,
  `fe80::/10`, `ff00::/8`, and IPv4-mapped. This is a thorough guard.

---

## Summary of findings

| ID | Component | Issue | Severity | Status |
|----|-----------|-------|----------|--------|
| SSRF-01 | tools/fetch.ts:200-220 | DNS rebinding — resolved IP not pinned (2 resolutions) | Medium (self-accepted) | CONFIRMED |
| SSRF-02 | plugins/web-search/index.ts:74-96 | No DNS check, no IPv6 ranges, no redirect re-validation, http allowed | Medium | CONFIRMED |
| SSRF-03 | mcp/transport.ts:40-77 | Permissive by design; no IPv6 IMDS/loopback, no DNS | Low (operator-config) | SUSPECTED |
| SSRF-04 | telegram / update-check / github-fetcher | Fixed operator/public origins, path-only user input | Low | CLEAN |
| SSRF-05 | tools/fetch.ts | Octal/hex/decimal/mapped/trailing-dot encodings | — | CLEAN (no bypass) |
