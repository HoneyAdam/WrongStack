# /fix — Problem Solver

## What it does

`/fix` classifies an error, bug, or problem description from **any language or framework**, activates the correct skill for the next agent turn, and drives a focused fix workflow — inline or via auto-delegation to a specialist subagent.

## Usage

```
/fix <error message or problem description>
```

No subcommands — the entire argument string is the problem description.

## Supported languages & frameworks

TypeScript, Rust, Go, Python, Ruby, Java, Kotlin, Swift, C/C++, C#,
PHP, Scala, Perl, Haskell, Elixir, Node.js, React, Next.js, Vue, Angular,
Docker, Git, CI/CD, and more.

## Classification matrix

| Error type | Patterns detected | Language | Skill activated |
|-----------|-------------------|----------|-----------------|
| **TypeScript** | `TS####`, `type error`, `: any`, `as any` | TypeScript | `typescript-strict` |
| **Rust panic** | `E####`, `panicked at`, `thread.*panicked` | Rust | `bug-hunter` |
| **Go build** | `go build`, `golang.*error`, `nil pointer` | Go | `bug-hunter` |
| **Python traceback** | `Traceback (most recent call last)`, `ModuleNotFoundError` | Python | `bug-hunter` |
| **Java exception** | `java.lang.*`, `NullPointerException` | Java | `bug-hunter` |
| **C/C++ compile** | `c####`, `gcc.*error`, `fatal error c` | C/C++ | `bug-hunter` |
| **Segmentation fault** | `segmentation fault`, `segfault`, `core dumped` | C | `bug-hunter` |
| **Node.js runtime** | `node:`, `err_*`, `ECONNREFUSED` | JS | `node-modern` |
| **React / Next.js** | `react-dom`, `invalid hook call`, `next.js` | JS | `react-modern` |
| **Security / secrets** | `sql injection`, `secret`, `apikey`, `eval`, `innerHTML` | Any | `security-scanner` |
| **Memory / perf** | `memory leak`, `OOM`, `infinite loop` | Any | `bug-hunter` |
| **Module not found** | `Cannot find module`, `ModuleNotFoundError` | Any | `bug-hunter` |
| **Infrastructure** | `git merge conflict`, `docker`, `ci/cd`, `github action` | Config | `bug-hunter` |

## How it works

### Step 1 — Classification

The `fix-classifier.ts` module runs through a prioritized pattern table (first match wins) and returns a `Classification`:

```
category     → 'ts' | 'security' | 'runtime' | 'compile' | 'dep' | 'perf' | 'infra' | 'logic' | 'lint' | 'general'
subcategory  → narrow type (e.g. 'null-undefined-access', 'python-traceback')
language     → detected language or 'unknown'
confidence  → 0.3–1.0
errorCode   → 'TS2345', 'E0503', 'C0005', etc.
skillHints   → skill names to activate
```

### Step 2 — Skill injection

Matched skills (bug-hunter, typescript-strict, security-scanner, node-modern, react-modern) are injected via the existing `DefaultSkillLoader` into the next system prompt automatically — no extra config.

### Step 3 — Fix path

| Confidence | Fix path |
|------------|----------|
| ≥ 0.85 | Inline: returns `runText` with a 5-step directive for the agent to fix immediately |
| < 0.85 | Auto-delegate: sets `delegateRequested: true` + `delegateRole` and triggers subagent dispatch via `onFix` callback |

### Step 4 — Agent directive

`runText` contains the error wrapped in a fenced code block plus a category-specific 5-step fix plan:

```markdown
## Fix: TypeScript Error (language: typescript)

```
TS2345: Argument of type 'string | null' is not assignable
```

Your task:
1. Search for the error location...
2. Read the source file(s)...
...
```

## Return shape

```typescript
interface FixResult {
  message?: string;          // shown immediately to user
  runText?: string;         // injected as next user message
  metadata?: {
    skillHints?: string[];
    delegateRequested?: boolean;
    delegateRole?: string;  // 'bug-hunter' | 'typescript-strict' | 'security-scanner' | 'refactor-planner'
    delegateTask?: string;   // full task prompt for subagent
  };
}
```

## Delegation

Auto-delegation triggers when `confidence < 0.85` or the problem spans multiple files. Set `onFix` in `SlashCommandContext` to enable the subagent dispatch callback. The coordinator maps:

| category | delegate role |
|----------|--------------|
| `ts` | `typescript-strict` |
| `security` | `security-scanner` |
| `perf` | `refactor-planner` |
| (all others) | `bug-hunter` |

## Examples

```
/fix TS2345: Argument of type 'string | null' is not assignable
/fix TypeError: Cannot read property 'map' of undefined
/fix error[E0503]: expected something but found E0503 in src/lib.rs
/fix Segmentation fault (core dumped) at main.rs:42
/fix AttributeError: 'NoneType' object has no attribute 'encode' (Python)
/fix react-dom.development.js:172 Error: Invalid hook call
/fix Security: hardcoded API key in config.ts
/fix SQL injection vulnerability in query builder
/fix ERRO1014: SQL injection vulnerability in query builder
/fix memory leak caused by event listener not being removed
/fix git merge conflict in branches feature/auth
/fix GitHub Actions pipeline failed: docker build returned non-zero exit code
```

## Code reference

- `packages/cli/src/slash-commands/fix-classifier.ts` — language-agnostic pattern classifier
- `packages/cli/src/slash-commands/fix.ts` — slash command + directive builder
- `packages/core/src/execution/skill-loader.ts` — skill injection into system prompt