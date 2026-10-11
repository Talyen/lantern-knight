# Agent workflow

Prototype iteration is the default. Preserve unrelated edits. [Development](docs/development.md) owns the edit loop; small sequential edits need no task registry or evidence database.

Start with the relevant [owner](docs/architecture.md#owners) or [guide](README.md#documentation) and matching [skill](.agents/skills/README.md). Use `npm run --silent docs:read -- --search '<phrase>'` when the guide is unknown; `<file.md>#<heading>` reads a bounded section, and a path alone lists anchors and section sizes. Follow continuation commands when needed. Search that owner's paths before opening code. [Agent context](docs/development.md#agent-context) owns discovery and output guidance.

Before independent/concurrent editing, verify `git rev-parse --show-toplevel` and `git worktree list`, then use a distinct worktree with an intended common baseline and clear ownership. [Task coordination](docs/task-coordination.md) owns isolation, resource locks and integration. Task-relevant messages to other Codex chats are authorized; external messages, pushes, publication and deletion remain separately controlled.

Finish with fresh `npm run check`; also run `npm run docs:check` for prose edits. [Verification](docs/verification.md) owns high-value tests (zero new tests is valid), CI/browser coverage and asset/native/visual checks. Report actual coverage. One owner integrates into local `main` and commits reviewed/verified task-owned changes under [standing commit authorization](docs/task-coordination.md#handoff-and-commits). Report the hash and integration status; push only when requested.

# Artwork and assets

Before artwork/texture generation, editing, replacement or art direction, apply `lantern-art-direction` at `/Users/ryanmcintire/.codex/skills/lantern-art-direction/SKILL.md`. Every generation prompt includes the canonical `references/canon/clean-ink-style.prompt.txt` block, highest native resolution/quality and literal `gpt-image-2.5 sunburst`. Inspect outputs under [canonical style](references/canon/clean-ink-style-sources.md); preserve original sources and canonical hero artwork.

For production composition, follow [scene policy](docs/scene-design.md) and [lantern-scene-design](.agents/skills/lantern-scene-design/SKILL.md). Preserve existing art direction; design advice permits valid experiments.

[Assets](docs/assets.md) owns preparation, immutable delivery, external cache budgets and active leases. Keep code, focused tests, small recipes and current docs in Git; generated packs/catalogs, staging, captures, logs and history stay outside Git. Ordinary code/CI consumes `assets/lock.json`; do not crawl the source library, cache, dependency lockfile or generated packs for context. Use `npm run assets:inspect -- <asset-id>` for bounded details.

Asset prototypes use source-verified `npm run assets:prepare -- --ids <asset-id>`. Builds/CI never regenerate artwork. `npm run assets:publish` requires explicit delivery authorization; preserve the pin until then.
