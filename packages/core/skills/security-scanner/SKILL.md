---
name: security-scanner
description: |
  Security vulnerability scanning for code and configuration. Covers secret detection,
  injection vectors, dependency vulnerabilities, and supply chain risks.
  Use during CI, before releases, or as a standalone audit.
version: 1.0.0
---

# Security Scanner Agent

Scans code, configs, and dependencies for security issues ranging from
hardcoded secrets to injection vulnerabilities and supply chain risks.

## Capabilities

- Detect hardcoded secrets: API keys, tokens, passwords, private keys
- Find injection vectors: eval, innerHTML, SQL concatenation, shell injection
- Identify insecure patterns: weak crypto, hardcoded IVs, disabled TLS verification
- Scan dependencies for known CVEs (via package audit)
- Flag supply chain risks: unverified scripts, postinstall hooks, .npmrc issues

## Workflow

1. **Scope** — Accept paths or use sensible defaults
2. **Secrets Scan** — Regex scan for credential patterns
3. **Injection Scan** — Pattern match dangerous constructs
4. **Config Scan** — Check TLS, crypto, auth configurations
5. **Dependency Scan** — Run audit on package.json
6. **Report** — Prioritized markdown with remediation

## Input

```json
{
  "task": "scan | audit | secrets | dependencies",
  "paths": ["src", "config"],
  "depth": "quick | normal | deep",
  "excludePaths": ["node_modules", "dist"]
}
```

## Output Format

```
## Security Scan Report — <timestamp>

### CRITICAL: Secrets Found
1. **[CRITICAL]** `config/keys.ts:8` — AWS Access Key ID exposed
   ```
   const awsKey = "AKIAIOSFODNN7EXAMPLE"; // ← remove this
   ```
2. **[CRITICAL]** `.env:3` — Private key committed to repo
   ```
   PEM_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE..."
   ```

### HIGH: Injection Vectors
3. **[HIGH]** `lib/renderer.ts:42` — innerHTML assignment
   ```ts
   element.innerHTML = userInput; // ← sanitize or use textContent
   ```
4. **[HIGH]** `tools/shell.ts:15` — shell injection via template literal
   ```ts
   exec(`echo ${userInput}`); // ← escape or use array form
   ```

### MEDIUM: Insecure Patterns
5. **[MEDIUM]** `lib/crypto.ts:9` — MD5 used for hashing (not for passwords)
6. **[MEDIUM]** `server.ts:22` — TLS certificate verification disabled

### Dependency Issues
7. **[HIGH]** `lodash < 4.17.21` — CVE-2021-23337
8. **[MEDIUM]** `minimist < 1.2.6` — CVE-2021-44906

## Summary
| Severity | Count |
|----------|-------|
| Critical | 2     |
| High     | 4     |
| Medium   | 3     |
| Low      | 1     |

## Remediation Checklist
- [ ] Remove hardcoded secrets from `config/keys.ts`
- [ ] Sanitize user input before innerHTML assignment
- [ ] Update lodash to >= 4.17.21
- [ ] Enable TLS verification in production
```

## Secret Pattern Reference

| Pattern | Example | Severity |
|---------|---------|----------|
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | critical |
| AWS Secret Key | `[a-zA-Z0-9/+=]{40}` base64 | critical |
| GitHub Token | `ghp_[a-zA-Z0-9]{36}` | critical |
| Private Key PEM | `-----BEGIN.*PRIVATE KEY-----` | critical |
| JWT | `eyJ[a-zA-Z0-9_-]+` | high |
| Generic API Key | `[a-zA-Z0-9]{32,}` | medium |

## Injection Patterns

| Construct | Safe Alternative |
|-----------|-----------------|
| `eval(str)` | `new Function()` or parse |
| `innerHTML = x` | `textContent` or sanitize |
| `exec(\`cmd ${input}\`)` | `execFile` with args array |
| `SQL = "SELECT * FROM " + table` | parameterized query |
| `fs.readFile(path + userInput)` | `path.resolve` + allowlist |

## Anti-patterns

- Don't scan node_modules — noise, use `npm audit` instead
- Don't report without remediation — "found X" is useless without "do Y"
- Don't ignore false positives — verify before flagging (especially regex-based secrets)
- Don't skip dependency scanning — supply chain is a real attack vector