# Lantern Knight artwork

For any artwork or texture generation, editing, replacement, or art-direction work in this project, read and apply the `lantern-art-direction` skill at `/Users/ryanmcintire/.codex/skills/lantern-art-direction/SKILL.md` before making generation calls.

The project source of truth is `references/canon/clean-ink-style.prompt.txt`; provenance is in `references/canon/clean-ink-style-sources.md`. Include the canonical style block in every generation prompt, request the highest available native resolution and quality, and include the literal model request `gpt-image-2.5 sunburst`. Inspect outputs and reject boiled, grainy, mottled or photographic surfaces. Do not treat noisy concept imagery as a replacement style reference.

Keep original sources and canonical hero artwork intact. Painted 2.5D environment geometry is allowed. These artwork instructions do not change unrelated coding workflows or add per-asset approval requirements.

# Repository map and asset boundaries

- `src/core`: simulation, sessions, saves and input. `src/content`: authored gameplay/scene definitions. `src/presentation`: Game, Sandbox, lighting and effects. `tools/assets`: asset preparation, pack delivery, cache and retention.
- Keep code, focused tests, small authored recipes and current documentation in Git. Never commit atlases, expanded catalogs, staging data, captures, logs or historical output. `npm run repo:check` enforces path and size boundaries.
- Source authority is the external iCloud-backed Asset Library. Ordinary agent/code work and CI use `assets/lock.json`; do not crawl the library, asset cache, dependency lockfile or generated pack contents to obtain general context.
- Use `npm run assets:inspect -- <asset-id>` for bounded asset details. Open a particular original or diagnostic only when needed for the task. Sources are recovered automatically by hash after reorganization.
- [Contributing](CONTRIBUTING.md) owns verification, high-value test selection, E2E coverage and execution budgets, and coordination for concurrent agents. `npm run check` runs the full regular gates, including documentation validation, and rejects results if authored inputs change. Builds and tests automatically fetch the exact pinned pack and reuse valid local copies offline.
- Requested runtime-asset changes include validated publication and pinning through `npm run assets:finalize` without another user approval prompt; [the asset workflow](docs/assets.md#local-preparation-review) owns completion and concurrent-batch coordination. Preview-only experiments stay local.
- `npm run assets:prepare` and asset finalization are explicit art-authoring operations. Neither ordinary builds nor CI regenerate source artwork. Cache data stays outside the checkout, with a 4 GiB limit and active process leases.
- Success produces concise summaries. Failures create bounded temporary diagnostics. Use `--capture` only for an explicit visual investigation. Delete obsolete output through the asset cleanup workflow; do not add historical reports to the repository.
