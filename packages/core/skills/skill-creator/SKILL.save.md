# Skill Creator — WrongStack (Compact)

Guides the creation of new WrongStack skills. A skill is a Markdown file with YAML frontmatter.

## Rules

1. First sentence of `description` = trigger — the only thing the skill loader matches on.
2. Name must be kebab-case: `my-skill`, `docker-deploy` — lowercase, hyphens only.
3. Skills live in `.wrongstack/skills/<name>/SKILL.md` (project level) or `packages/core/skills/<name>/SKILL.md` (bundled).
4. After the trigger sentence, add `Triggers: user says "X", "Y", "Z".`
5. Content must be actionable — rules, patterns, anti-patterns.
6. End with "Skills in scope" listing related skills for delegation.

## Workflow

1. Ask the name — suggest kebab-case, validate format
2. Ask the trigger — "What situation should activate this skill?"
3. Ask the coverage — what rules, patterns, workflows?
4. Generate the SKILL.md — write to `.wrongstack/skills/<name>/SKILL.md`
5. Confirm — show the path