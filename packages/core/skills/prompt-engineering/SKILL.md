---
name: prompt-engineering
description: |
  Use this skill when designing system prompts, tool descriptions, or task
  instructions for LLM agents. Covers structure, specificity, and common pitfalls.
version: 1.0.0
---

# Prompt engineering

## Structure

- Identity → principles → environment → memory. (WrongStack's 4-layer system prompt.)
- Static content first (cacheable), volatile last.
- Markdown headings help models parse structure.

## Tool descriptions

- Describe *when* to use, not just *what*. "Use `read` before `edit`" is more useful than "reads files".
- Include schema constraints in prose; the JSON schema alone is rarely enough.
- Give one example for non-obvious tools.

## Anti-patterns

- "Please" / "kindly" — adds tokens, no benefit.
- "You are a helpful AI assistant" — already implied, wastes tokens.
- Long preamble before the actual question.
- Ambiguous pronouns ("do it again") — names beat pronouns.
