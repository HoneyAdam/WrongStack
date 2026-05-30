# /skill-gen — LLM-Guided Skill Authoring

## What it does

Launches an interactive skill creation session. The AI reads the `skill-creator` skill and guides you through defining the skill name, trigger description, and instructor body — validating the format, writing the file, and confirming the location.

No separate wizard — the LLM handles the conversation, validation, and file writing. The agent acts as both interviewer and writer.

## Usage

| Usage | Effect |
|---|---|
| `/skill-gen` | Start interactive skill creation |
| `/skill-gen list` | List existing skills (shows name + scope + trigger) |
| `/skill-gen edit <name>` | View an existing skill's full body |

## How it works

1. AI reads `packages/core/skills/skill-creator/SKILL.md` to understand the skill format
2. Asks clarifying questions about the skill's purpose and scope
3. Generates the `SKILL.md` content with frontmatter (`name`, `description`, `version`) and body
4. Validates format (frontmatter fields, description quality, token budget ≤ 2000)
5. Writes to the appropriate scope:
   - **Project**: `<projectRoot>/.wrongstack/skills/<name>/SKILL.md`
   - **User-global**: `~/.wrongstack/skills/<name>/SKILL.md`
6. Confirms location and scope

## Skill output format

```markdown
---
name: my-skill
description: |
  Use this skill when <trigger condition>.
  Triggers: user says "X", "Y".
version: 1.0.0
---

# My Skill

## Overview
One-line description of what this skill does.

## Rules
1. Rule one
2. Rule two

## Patterns
### Do
```ts
// good example
```

### Don't
```ts
// bad example
```

## Skills in scope
- `other-skill` — for delegation when this skill needs help
```

## Prompt engineering tips (for the AI interviewer)

The skill creator follows the `skill-creator` SKILL.md which instructs:
- Ask about **name** (slug, unique identifier)
- Ask about **trigger** (when should the agent activate this skill?)
- Ask about **instructor** (what should the agent do when active?)
- Verify **description quality** — specific, action-oriented, scope-limited
- Enforce **token budget** — target 200–800 tokens, hard cap 2000
- Check for **anti-patterns** — what NOT to do, duplicate names

## Code reference

- `packages/cli/src/slash-commands/skill-generator.ts`
- `packages/core/skills/skill-creator/SKILL.md` — the skill-creator skill (the prompt that guides the LLM)
- `docs/skills.md` — full skill authoring guide
- `packages/core/src/skills/skill-loader.ts`