# Modern React (19+) — WrongStack (Compact)

React 19+ patterns: Server Components by default, `use` hook for promises, clean client boundary management.

## Rules

1. Default to Server Components — mark `'use client'` only for interactive code.
2. Keep the client boundary minimal.
3. Don't use `useEffect` for data fetching — use Server Components or `use(promise)`.
4. Don't use `forwardRef` in new code — `ref` is a regular prop in React 19.
5. Use named exports for components.
6. Event handlers must have explicit types: `React.MouseEvent<HTMLButtonElement>`.

## Hook guide

| Hook | When to use | Anti-pattern |
|------|-------------|--------------|
| `useState` | Local state | Don't sync with props via useEffect |
| `useTransition` | Non-blocking updates | Don't use for urgent changes |
| `useDeferredValue` | Deferring expensive rendering | Don't use for simple state |
| `useCallback` | Stable function refs for deps | Don't memoize everything |
| `useMemo` | Expensive computations | Don't memoize trivial calcs |
| `use` | Awaiting promises in render | Only in component render |
| `useEffect` | Side effects only | Not for data fetching |