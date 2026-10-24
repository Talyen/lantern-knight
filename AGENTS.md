# Agent workflow

Prototype iteration is the default. Preserve unrelated edits. [Development](docs/development.md) owns the edit loop; small sequential edits need no task registry or evidence database.

Start with the relevant [owner](docs/architecture.md#owners) or [guide](README.md#documentation) and matching [skill](.agents/skills/README.md). [Agent context](docs/development.md#agent-context) explains bounded discovery.

[Task coordination](docs/task-coordination.md) owns isolated worktrees, standing commit authorization, integration and cleanup. [Verification](docs/verification.md#regular-checks) owns checks and evidence. Review and commit task changes, then run `npm run task:integrate` from the task worktree; it performs final verification under the shared lock. Report the result and stop.

# Visual interfaces

For UI and layout work, apply [frontend design](.agents/skills/frontend-design/SKILL.md), inspect the [visual reference set](references/visual/README.md), and follow [product copy](docs/product-copy.md). Substantial visual changes require rendered before/after review under [verification](docs/verification.md#visual-acceptance); tests alone do not establish aesthetic quality. Keep user-approved references distinct from agent candidates.

# Artwork and assets

Before artwork/texture generation, editing, replacement or art direction, apply `lantern-art-direction` at `/Users/ryanmcintire/.codex/skills/lantern-art-direction/SKILL.md`. Every generation prompt includes the canonical `references/canon/clean-ink-style.prompt.txt` block, highest native resolution/quality and literal `gpt-image-2.5 sunburst`. Inspect outputs under [canonical style](references/canon/clean-ink-style-sources.md); preserve original sources and canonical hero artwork.

Inspect the [visual reference set](references/visual/README.md) for scoped examples; agent candidates never supersede canonical source artwork.

For production composition, follow [scene policy](docs/scene-design.md) and [lantern-scene-design](.agents/skills/lantern-scene-design/SKILL.md). Preserve existing art direction; design advice permits valid experiments.

[Assets](docs/assets.md) owns preparation, immutable delivery, external cache budgets and active leases. Keep code, recipes, current docs and the repository-owned `asset-data/` originals and prepared objects in Git. Disposable assemblies, staging, captures, logs and history stay outside Git. Ordinary code/CI consumes `assets/lock.json` and repository-owned prepared objects without network asset downloads. Do not crawl bulk `asset-data/`, caches or dependency locks for context. Use `npm run assets:inspect -- <asset-id>` for bounded details.

New artwork enters only through explicit `assets:import`; never discover or recover assets from Documents. Asset prototypes use source-verified `npm run assets:prepare -- --ids <asset-id>`. Builds/CI never regenerate artwork. [Assets](docs/assets.md#preparation-and-publication) owns publication authorization, source verification, artwork inspection and immutable delivery checks.
