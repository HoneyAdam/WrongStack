# /skill · /skill-gen · /skill-install · /skill-update · /skill-uninstall

## /skill — Skill Browser

Lists all available skills or shows the full body of a named skill.

```bash
/skill              → list all skills with trigger hints
/skill <name>       → show full skill body
```

Skills are loaded by `DefaultSkillLoader` from three scopes:
- Bundled: `packages/core/skills/<name>/SKILL.md`
- User-global: `~/.wrongstack/skills/<name>/SKILL.md`
- Project-local: `<projectRoot>/.wrongstack/skills/<name>/SKILL.md`

Output for each skill shows its scope tags and the trigger condition text.

## /skill-gen — LLM-Assisted Skill Creator

Launches an interactive LLM-driven skill creation session. The LLM reads `packages/core/skills/skill-creator/SKILL.md` and guides you through defining:
- Skill name and scope
- Trigger conditions (when to activate)
- Instructor text (what the agent should do)

The LLM validates the format, writes the file, and confirms location. No separate wizard needed — it's conversational.

## /skill-install — Install a Skill

```
/skill-install <url-or-name>
```

Downloads and installs a skill from a URL or the skill registry. Installs to user-global scope (`~/.wrongstack/skills/`).

## /skill-update — Update Installed Skills

```
/skill-update            → update all user-global skills
/skill-update <name>     → update a specific skill
```

Checks the installed skill's source for a newer version and updates in place.

## /skill-uninstall — Remove a Skill

```
/skill-uninstall <name>
```

Removes the skill from user-global scope. Bundled skills cannot be uninstalled.

## Skill format (SKILL.md)

```markdown
# <skill name>

## When to use
_Trigger condition text — the agent reads this to know when to activate the skill._

## What to do
_Instructor text — what the agent should do when the skill is active._
```

See `packages/core/skills/skill-creator/SKILL.md` for the canonical skill format reference.

## Bundled skills

| Skill | Purpose |
|---|---|
| `audit-log` | Log parsing, anomaly detection, pattern recognition |
| `bug-hunter` | Static bug and code smell detection |
| `git-flow` | Commit message style, branch hygiene |
| `multi-agent` | Leader/worker roles, task delegation |
| `node-modern` | Node.js >= 22 idioms (ESM, native fetch, AbortSignal) |
| `prompt-engineering` | LLM agent system prompt design |
| `react-modern` | React 19+ patterns (Server Components, useTransition, Suspense, `use` hook) |
| `refactor-planner` | Dependency mapping, risk assessment, phased planning |
| `sdd` | Spec-driven development workflow |
| `security-scanner` | Security vulnerability scanning |
| `skill-creator` | Skill authoring guide and validation |
| `typescript-strict` | TypeScript strict mode patterns |

## Code reference

- `packages/cli/src/slash-commands/skill.ts`
- `packages/cli/src/slash-commands/skill-generator.ts`
- `packages/cli/src/slash-commands/skill-install.ts`
- `packages/core/src/skills/skill-loader.ts`
- `packages/core/src/skills/skill-installer.ts`
- `packages/core/skills/skill-creator/SKILL.md`
- `docs/skills.md`