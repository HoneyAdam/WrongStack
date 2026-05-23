---
name: skill-creator
description: |
  Use this skill when the user wants to create a new AI skill in WrongStack.
  Triggers: user says "create a skill", "new skill", "add a skill", "skill definition".
version: 1.1.0
---

# Skill Creator — WrongStack

Guide the user through creating a new skill. You are the wizard — ask questions, validate answers, write the file.

## Skill format

Every skill is a Markdown file with YAML frontmatter:

```markdown
---
name: my-skill-name
description: |
  Use this skill when <trigger situation>.
  Triggers: user says "keyword", "another keyword".
version: 1.0.0
---

# Skill Title

## Overview
What this skill does.

## Rules
- Rule 1
- Rule 2

## Patterns
### Do
\`\`\`ts
// good example
\`\`\`

### Don't
\`\`\`ts
// bad example
\`\`\`

## Workflow
1. Step one
2. Step two
```

## File Location

Skills live in directories under these paths (priority order):

1. **Project**: `<project>/.wrongstack/skills/<name>/SKILL.md`
2. **User global**: `~/.wrongstack/skills/<name>/SKILL.md`
3. **Bundled**: `packages/core/skills/<name>/SKILL.md` (read-only, for core team)

For user-created skills: always use path 1 (project level).

## Naming Rules

- **kebab-case**: `my-skill`, `docker-deploy`, `api-testing`
- Lowercase letters, numbers, hyphens only
- No spaces, no underscores, no uppercase
- Directory name = skill name

## The Trigger — the most important part

The **first sentence** of the `description` is the trigger. This is the **only** thing the skill loader matches on.

```
# ✅ Good — specific trigger that can be matched
Use this skill when deploying Docker containers to a production cluster.

# ❌ Bad — vague, can't be matched
This skill is about Docker deployment.

# ✅ Good — pattern-matchable
Use this skill when writing or reviewing React 19+ code.

# ❌ Bad — too broad
This skill is about code.
```

After the trigger sentence, add `Triggers: user says "X", "Y", "Z".` so agents know when to delegate.

## Description rules

- First sentence = trigger condition
- Second sentence = what it covers
- Triggers list = specific keywords or phrases
- Multi-line descriptions use YAML block scalar (`|`)

## Content Guidelines

- **Rules**: concrete do/don't rules, not vague advice
- **Patterns**: actual code examples, not pseudocode
- **Anti-patterns**: show what NOT to do with real code
- **Workflows**: step-by-step, actionable, not theoretical
- **Skills in scope**: list related skills at the bottom for delegation

## Creation Workflow

1. **Ask the name** — suggest kebab-case, validate format
2. **Ask the trigger** — "What situation should activate this skill?"
3. **Ask the coverage** — what rules, patterns, workflows?
4. **Generate the SKILL.md** — write to `.wrongstack/skills/<name>/SKILL.md`
5. **Confirm** — show the path, remind them to use `/skill` to list skills

## Validation Checklist

Before writing the file, verify:
- [ ] Name is valid kebab-case
- [ ] Name doesn't collide with existing skills
- [ ] Description has a clear trigger sentence
- [ ] Content is actionable (rules, patterns, not just prose)
- [ ] File will be placed in `.wrongstack/skills/`

## Existing skills (don't collide)

```
audit-log, bug-hunter, git-flow, multi-agent, node-modern,
prompt-engineering, react-modern, refactor-planner, sdd,
security-scanner, skill-creator, typescript-strict
```

## Skills in scope

- `prompt-engineering` — for crafting the skill description and prompt text
- `git-flow` — for committing the new skill file