---
name: react-modern
description: |
  Use this skill when writing or reviewing React 19+ code in WrongStack.
  Triggers: user mentions "React", "component", "useState", "useEffect",
  "Server Component", "Client Component", "Suspense", "useTransition", "use hook".
version: 1.1.0
---

# Modern React (19+) — WrongStack

## Component types

```tsx
// ✅ Server Component (default) — for data fetching and static UI
async function UserList() {
  const users = await db.query('SELECT * FROM users');
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}

// ❌ Client Component — mark only when needed
'use client';
import { useState } from 'react';
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

Rule: Default to Server Components. Mark `'use client'` only for interactive code. Keep the client boundary minimal.

## Data fetching

```tsx
// ✅ Server Component — direct await
async function Profile({ userId }: { userId: string }) {
  const user = await fetch(`/api/users/${userId}`).then(r => r.json());
  return <div>{user.name}</div>;
}

// ✅ Client Component — use(promise) for thenables
import { use } from 'react';
function UserData({ promise }: { promise: Promise<User> }) {
  const user = use(promise);
  return <div>{user.name}</div>;
}

// ❌ Bad — useEffect for data fetching
useEffect(() => { fetchData().then(setData); }, []);
```

## State management

```tsx
// ✅ useState for local state
const [count, setCount] = useState(0);

// ✅ useTransition for non-urgent updates
const [isPending, startTransition] = useTransition();
startTransition(() => {
  setPage(page + 1);
});

// ✅ useReducer for state machines
const [state, dispatch] = useReducer(reducer, initialState);

// ❌ useEffect for derived state
// Bad: compute during render instead
const fullName = firstName + ' ' + lastName;
```

## Hook rules

| Hook | When to use | Anti-pattern |
|------|-------------|--------------|
| `useState` | Local component state | Don't sync with props via useEffect |
| `useReducer` | Complex state logic | Don't chain useState for related state |
| `useTransition` | Non-blocking updates | Don't use for urgent state changes |
| `use` | Awaiting promises in render | Don't use outside component render |
| `useEffect` | Side effects only | Don't use for data fetching or derived state |

## Common React 19 changes

- `ref` is a regular prop — no more `forwardRef`
- Server Components can be nested without serialization
- `use(promise)` — await thenables directly in components
- Actions — server functions callable from client

## Anti-patterns

| Anti-pattern | Why bad | Fix |
|---|---|---|
| `useEffect` to sync props to state | Causes extra render, stale data | Use controlled component or lift state |
| Class components in new code | Deprecated | Use function components + hooks |
| `forwardRef` in new code | `ref` is a regular prop in React 19 | Pass `ref` as a normal prop |
| Default exports for components | Hinders refactoring | Named exports |
| Mixing Server/Client boundaries | Serialization errors | Keep boundary clean |

## TypeScript patterns

```tsx
// ✅ Props with explicit type
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

// ✅ Event handler types
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => { ... };

// ✅ useRef with nullable initial
const inputRef = useRef<HTMLInputElement>(null);
```

## Skills in scope

- `typescript-strict` — for TypeScript patterns
- `node-modern` — for React server components with Node.js
- `bug-hunter` — for React-specific bugs (stale closures, memory leaks)