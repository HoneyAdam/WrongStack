---
name: typescript-strict
description: |
  Use this skill when writing or reviewing TypeScript code with strict mode
  in WrongStack. Triggers: user mentions "TypeScript", "strict", "type error",
  "type safety", "narrowing", "branded type", "discriminated union", "noUncheckedIndexedAccess".
version: 1.1.0
---

# TypeScript Strict Mode — WrongStack

## Non-negotiable rules

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true,
  "exactOptionalPropertyTypes": true
}
```

Never silence errors with `as any`. Use `as unknown as T` only at trust boundaries with a comment.

## Common patterns

### Exhaustive switch

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled: ${JSON.stringify(x)}`);
}

switch (block.type) {
  case 'text': return renderText(block);
  case 'tool_use': return renderToolUse(block);
  case 'error': return renderError(block);
  default: return assertNever(block);
}
```

### Branded types for invariants

```ts
type UserId = string & { readonly __brand: 'UserId' };
type SessionId = string & { readonly __brand: 'SessionId' };

function toUserId(s: string): UserId {
  return s as UserId;
}

// now TypeScript won't let you accidentally pass SessionId where UserId is expected
```

### Discriminated unions

```ts
type Result =
  | { status: 'success'; data: User }
  | { status: 'error'; error: Error }
  | { status: 'loading' };

// ✅ TypeScript knows which fields exist in each branch
function handle(result: Result) {
  if (result.status === 'success') {
    console.log(result.data.name); // data exists here
  } else if (result.status === 'error') {
    console.log(result.error.message); // error exists here
  }
}
```

### noUncheckedIndexedAccess

After enabling `noUncheckedIndexedAccess: true`, array/object access returns `T | undefined`:

```ts
const items = ['a', 'b', 'c'];
const first: string | undefined = items[0]; // ✅ correct
const last = items[items.length - 1]; // string | undefined

// ✅ Always handle the undefined case
if (items[0] !== undefined) {
  console.log(items[0].toUpperCase());
}

// ✅ Or use a guard helper
const first = items.at(0);
if (first) console.log(first.toUpperCase());
```

## Anti-patterns

| Anti-pattern | Why bad | Fix |
|---|---|---|
| `!` non-null assertion | Silences the type checker | Use a narrow check |
| `Promise<any>` return type | Loses type safety | Use `Promise<unknown>` or generic |
| `Function` or `Object` types | Too broad | Be specific |
| `as any` for shortcuts | Defeats type safety | `as unknown as T` at boundaries |
| Optional chaining chain | `a?.b?.c?.d` when `a` might be undefined | Verify with if/guard first |
| Missing return types on exports | Hides errors | Always annotate public APIs |

## Useful utility types

```ts
// Make properties optional
type Partial<T> = { [P in keyof T]?: T[P] };

// Make properties required
type Required<T> = { [P in keyof T]-?: T[P] };

// Pick specific properties
type UserPreview = Pick<User, 'id' | 'name'>;

// Omit specific properties
type UserWithoutPassword = Omit<User, 'password'>;

// Readonly arrays
function processItems(items: readonly string[]): void { ... }
```

## Strict null checking

```ts
// ✅ Good — explicit handling
const name: string | null = getName();
if (name !== null) {
  console.log(name.toUpperCase());
}

// ✅ Optional chaining + nullish coalescing
const len: number = str?.length ?? 0;

// ❌ Bad — assumes not null
console.log(name!.toUpperCase());
```

## Skills in scope

- `node-modern` — for TypeScript + ESM patterns
- `react-modern` — for React + TypeScript patterns
- `bug-hunter` — for type-related bugs like unsafe casts