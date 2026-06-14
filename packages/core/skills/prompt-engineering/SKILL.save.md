# Prompt Engineering — WrongStack (Compact)

Designs, critiques, and fixes system prompts, tool descriptions, and skill definitions.

## Rules

1. Static content first, volatile last — cache-friendly prompts cost less.
2. First sentence of skill description = trigger — keep it specific.
3. Tool descriptions must say: when to use, key parameters, what it returns.
4. Remove filler ("Please be helpful", "Sure, I'd be happy to") — wastes tokens.
5. Always read before edit — agents should read first, then edit.

## WrongStack's 4-layer prompt structure

```
Layer 1: Identity     — Who you are (static, cacheable)
Layer 2: Tool usage   — Tools and usage hints (static)
Layer 3: Environment  — Context, skills, modes (semistatic)
Layer 4: Volatile     — Session state, errors, mode prompt (dynamic)
```

## Anti-patterns

| Anti-pattern | Fix |
|--------------|-----|
| "Please be helpful" | Remove it |
| Vague parameter docs | Add concrete examples |
| Long preamble | Put question first |
| Ambiguous pronouns | Name the specific thing |