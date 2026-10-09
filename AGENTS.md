# Agent workflow

Prototype iteration is the default. Preserve unrelated edits. Start independent work in an isolated worktree containing the intended baseline; run `npm run task:start -- <name> --paths <paths...>` before editing. Refresh owners, contracts, checks and evidence with `npm run agent:context -- [paths...]`. Discovery paths never restrict verification. [Contributing](CONTRIBUTING.md) routes detailed policies.

Finish with focused `npm run check`; changed browser interactions need one `scene:probe` or `ui:probe`. Full checks, packaging and exhaustive journeys belong to explicit integration/delivery or CI. Capture only for explicit visual investigations. Local evidence does not establish hosted CI or visible approval.

Future worktree tasks follow [handoff and commits](docs/task-coordination.md#handoff-and-commits): integrate into local `main`, commit task-owned changes, and report integration status plus commit hash. Push only when requested.

# Artwork and scenes

Before artwork/texture generation, editing, replacement or art direction, apply `lantern-art-direction` at `/Users/ryanmcintire/.codex/skills/lantern-art-direction/SKILL.md`. Include the canonical `references/canon/clean-ink-style.prompt.txt` block, highest native resolution/quality and literal `gpt-image-2.5 sunburst` in every generation prompt. Provenance: [style sources](references/canon/clean-ink-style-sources.md). Inspect outputs; reject boiled, grainy, mottled or photographic surfaces. Preserve original sources and canonical hero artwork; noisy concepts are not style references.

Production scenes follow [scene policy](docs/scene-design.md) and [lantern-scene-design](.agents/skills/lantern-scene-design/SKILL.md): flat stages, intact illustrated shells and registered ground panels. Rendering carriers, hidden collision and shadow proxies remain supported.

# Repository boundaries

- Owners: core simulation/save/input; content gameplay/scenes; presentation rendering/effects; asset tools preparation/delivery/cache.
- Keep code, focused tests, small recipes and current docs in Git. Generated packs/catalogs, staging, captures, logs and historical output stay outside Git; `repo:check` enforces boundaries.
- Ordinary code/CI consumes `assets/lock.json`. Do not crawl the source Asset Library, cache, dependency lockfile or generated packs for context. Use `assets:inspect -- <asset-id>` for bounded details.
- Asset prototypes finish through source-verified `assets:dev -- --ids <asset-id>`. Preparation/finalization are explicit art-authoring operations; builds/CI never regenerate artwork. Publication/pinning via `assets:finalize` is explicit delivery. Preserve the published pin; external cache retains its 4 GiB limit and active leases.

# Skill routing

Apply [architect](.agents/skills/architect/SKILL.md) for revised cross-boundary contracts and [run-audits](.agents/skills/run-audits/SKILL.md) for requested [audits](docs/audits/README.md). [Routing](.agents/skills/README.md) describes applicability.
