# Agent workflow

Prototype iteration is the default. Preserve unrelated edits. Use isolated worktrees for independent/concurrent work, with an intended common baseline and clear ownership. Small sequential edits need no task registration or evidence database. [Development](docs/development.md) owns the normal loop.

Before concurrent editing, verify the task's checkout with `git rev-parse --show-toplevel` and `git worktree list`; use a distinct worktree rather than sharing the primary checkout. Keep implementation and checks independent. Coordinate only for concrete dependencies, overlapping scope, shared contracts or final integration. One owner at a time integrates into local `main`; [task coordination](docs/task-coordination.md) owns the handoff.

The user authorizes task-relevant messages to other Codex chats. This permission does not require routine progress broadcasts or repeated editing-status inquiries, and does not authorize external messages, pushes, publication or deletion. Use resource locks for routine contention; message only when a concrete problem needs another owner's action.

Finish ordinary work with fresh `npm run check`. Write or retain only high-value tests under [test value](docs/verification.md#test-value); zero new tests can be appropriate. Fast suites are the local default; slow/integration checks run in CI by default, with targeted local diagnosis or validation allowed. Changed browser interactions need appropriate CI coverage and an accurate report of whether it ran. Assets, native integration and milestone delivery have separate checks in [verification](docs/verification.md). Capture for explicit visual investigations. Report actual evidence; local checks do not establish hosted CI or visible approval.

Integrate task-owned work into local `main`, commit reviewed/verified changes under [handoff and commits](docs/task-coordination.md#handoff-and-commits), and report the hash and integration status. Push only when requested.

# Artwork and scenes

Before artwork/texture generation, editing, replacement or art direction, apply `lantern-art-direction` at `/Users/ryanmcintire/.codex/skills/lantern-art-direction/SKILL.md`. Include the canonical `references/canon/clean-ink-style.prompt.txt` block, highest native resolution/quality and literal `gpt-image-2.5 sunburst` in every generation prompt. Provenance: [style sources](references/canon/clean-ink-style-sources.md). Inspect outputs; reject boiled, grainy, mottled or photographic surfaces. Preserve original sources and canonical hero artwork; noisy concepts are not style references.

Prototype scene guidance follows [scene policy](docs/scene-design.md) and [lantern-scene-design](.agents/skills/lantern-scene-design/SKILL.md): prefer flat stages, intact illustrated shells and registered ground panels. Design preferences are advice; valid experiments can differ. Rendering carriers, hidden collision and shadow proxies remain supported.

# Repository boundaries

- Owners: core simulation/save/input; content gameplay/scenes; presentation rendering/effects; asset tools preparation/delivery/cache.
- Keep code, focused tests, small recipes and current docs in Git. Generated packs/catalogs, staging, captures, logs and historical output stay outside Git.
- Ordinary code/CI consumes `assets/lock.json`; do not crawl the source library, cache, dependency lockfile or generated packs for context. Use `npm run assets:inspect -- <asset-id>` for bounded details.
- Asset prototypes use source-verified `npm run assets:prepare -- --ids <asset-id>`. Builds/CI never regenerate artwork. Publication/pinning through `npm run assets:publish` is explicit delivery. Preserve the existing pin until that operation; the external cache retains its 4 GiB limit and active leases.

# Skill routing

Select local skills automatically when the task matches their descriptions; no slash command or skill-name mention is required. Apply only the relevant workflow within the requested scope.

Use [architect](.agents/skills/architect/SKILL.md) for changed shared contracts, [run-audits](.agents/skills/run-audits/SKILL.md) for requested [audits](docs/audits/README.md), and [scene guidance](.agents/skills/lantern-scene-design/SKILL.md) for composition. [Routing](.agents/skills/README.md) describes applicability.

Use [frontend-design](.agents/skills/frontend-design/SKILL.md) for menus, HUD, and developer interface design; preserve existing art direction and scene guidance.
