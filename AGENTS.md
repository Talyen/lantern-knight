# Agent workflow

Prototype iteration is the default. Preserve unrelated edits. Follow [Development](docs/development.md); small sequential edits need no task registry or evidence database.

Before independent/concurrent editing, verify `git rev-parse --show-toplevel` and `git worktree list`, then use a distinct worktree with an intended common baseline and clear ownership. Keep implementation and checks independent. Coordinate for concrete dependencies, overlapping scope, shared contracts or integration; resource locks handle routine contention. Task-relevant messages to other Codex chats are authorized; external messages, pushes, publication and deletion are not.

Finish with fresh `npm run check`; also run `npm run docs:check` for prose edits. Retain only [high-value tests](docs/verification.md#test-value), allowing zero new tests. Slow/integration checks default to CI; targeted local validation is allowed. Changed browser interactions need appropriate CI coverage. [Verification](docs/verification.md) owns asset/native/milestone checks. Capture explicit visual investigations and report actual coverage; local checks establish neither hosted CI nor visible approval.

One owner integrates into local `main` and commits reviewed/verified task-owned changes under [handoff and commits](docs/task-coordination.md#handoff-and-commits). Preserve other owners' work; report the hash and integration status. Push only when requested.

# Context and discovery

Start with the relevant owner in [Architecture](docs/architecture.md#owners) or [README's guide index](README.md#documentation); read only the matching sections and skills. Search the owner's directory with `rg -n` or list paths with `rg --files` before opening files. Follow symbols and callers as needed. [Development](docs/development.md#agent-context) owns search/output details. Reuse unchanged findings within the task; refresh changed inputs and final verification.

# Artwork and assets

Before artwork/texture generation, editing, replacement or art direction, apply `lantern-art-direction` at `/Users/ryanmcintire/.codex/skills/lantern-art-direction/SKILL.md`. Every generation prompt includes the canonical `references/canon/clean-ink-style.prompt.txt` block, highest native resolution/quality and literal `gpt-image-2.5 sunburst`. [Provenance](references/canon/clean-ink-style-sources.md). Inspect outputs; reject boiled, grainy, mottled or photographic surfaces. Preserve original sources and canonical hero artwork; noisy concepts are not style references.

For production composition, follow [scene policy](docs/scene-design.md) and [lantern-scene-design](.agents/skills/lantern-scene-design/SKILL.md): prefer flat stages, intact illustrated shells and registered ground panels. Design advice permits valid experiments; rendering carriers, hidden collision and shadow proxies remain supported.

Keep code, focused tests, small recipes and current docs in Git; generated packs/catalogs, staging, captures, logs and history stay outside Git. Ordinary code/CI consumes `assets/lock.json`; do not crawl the source library, cache, dependency lockfile or generated packs for context. Use `npm run assets:inspect -- <asset-id>` for bounded details.

Asset prototypes use source-verified `npm run assets:prepare -- --ids <asset-id>`. Builds/CI never regenerate artwork. `npm run assets:publish` requires explicit delivery authorization; preserve the pin until then. The external cache retains its 4 GiB limit and active leases.

# Skills

Apply matching [local skills](.agents/skills/README.md) automatically within scope: `architect` for changed shared contracts, `run-audits` for requested audits, `frontend-design` for menus/HUD/developer interfaces, and scene guidance for production composition. Preserve existing art direction.
