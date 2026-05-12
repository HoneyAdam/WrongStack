---
name: react-modern
description: |
  Use this skill when writing or reviewing React 19+ code. Covers Server
  Components vs Client Components, useTransition, Suspense, the `use` hook,
  Actions, and form state.
version: 1.0.0
---

# Modern React (19+)

## Component types

- Default to Server Components for data fetching and static UI.
- Mark interactive code with `'use client'` and keep it minimal.
- Don't pass Server Components into Client Component children unless serialized.

## Data fetching

- In Server Components: `await fetch(...)`, server-side caching is automatic with framework support.
- In Client Components: use a library (TanStack Query) or `use(promise)` for awaitable thenables.

## State

- `useState` for local state. `useReducer` for state machines.
- `useTransition` for non-urgent updates that should not block input.
- Avoid `useEffect` for derived state — compute during render.

## Anti-patterns

- `useEffect` to sync local state with props
- Class components in new code
- `forwardRef` in new code (React 19 makes `ref` a regular prop)
- Default exports for components (named exports help refactor tools)
