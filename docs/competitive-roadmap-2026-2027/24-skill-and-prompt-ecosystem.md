# Skill and Prompt Ecosystem

**Priority:** P2  
**Horizon:** 6–12 months  
**Status:** Proposed

## Outcome

Evolve existing skill search/install and prompt libraries into a versioned, trustworthy ecosystem with dependency resolution, evaluation, and reusable project templates.

## Scope

- Skill manifests with versions, compatibility, dependencies, checksums, publisher identity, and changelog.
- Lockfile-based installation, update preview, rollback, and revocation.
- Prompt version history, datasets, variants, offline/online evaluation, cost, and quality metrics.
- A prompt studio for comparing rendered prompts and controlled experiments.
- Curated framework/language starter packs combining skills, prompts, safe config, and example workflows.

## Architecture

- Preserve current discovery priority and agentskills.io-compatible `SKILL.md` loading.
- Registry metadata is untrusted and cannot expand tool permissions or configure executable integrations.
- Dependencies resolve before installation and are cycle/size bounded.
- Prompt experiments never mutate the bundled read-only dataset.

## Delivery plan

1. Add local package metadata and a lockfile while retaining repository installs.
2. Add version resolution, verification, and rollback.
3. Build prompt eval schemas and a CLI runner.
4. Add WebUI discovery/eval UX and curated starter packs.
5. Open community publishing after moderation and revocation processes exist.

## Acceptance criteria

- Installed content is pinned and verifiable offline.
- Updates show body/resource/permission-impact diffs before activation.
- Eval results include dataset, evaluator, model, cost, and variance metadata.
- A malicious registry response cannot write outside skill/prompt destinations or alter runtime config.

