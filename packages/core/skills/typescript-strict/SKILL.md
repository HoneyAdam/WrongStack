---
name: typescript-strict
description: |
  Use this skill when writing or reviewing TypeScript code with strict mode.
  Covers strict null checks, exhaustive switch, branded types, discriminated
  unions, and noUncheckedIndexedAccess pitfalls.
version: 1.0.0
---

# TypeScript strict mode

## Core rules

- `strict: true` is non-negotiable. So is `noUncheckedIndexedAccess: true`.
- Never silence type errors with `as any`. Use `as unknown as T` only at trust boundaries with a comment explaining why.
- Prefer discriminated unions over enums.
- Use `readonly` aggressively on properties and arrays.

## Common patterns

### Exhaustive switch

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled: ${JSON.stringify(x)}`);
}

switch (block.type) {
  case 'text': return renderText(block);
  case 'tool_use': return renderToolUse(block);
  default: return assertNever(block);
}
```

### Branded types for invariants

```ts
type UserId = string & { readonly __brand: 'UserId' };
const toUserId = (s: string): UserId => s as UserId;
```

### noUncheckedIndexedAccess

After enabling this, `arr[i]` is `T | undefined`. Don't disable it — handle the undefined explicitly.

## Anti-patterns

- `!` non-null assertion in production code (use a narrow check)
- Returning `Promise<any>` from a public API
- `Function` or `Object` types — always be specific
