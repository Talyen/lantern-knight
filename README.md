# Lantern Knight

The opening has two playable areas: Graveyard Approach (one skeleton) and Ruined Chapel (two). Game and Dev share the renderer, combat, session and persistence lifecycle. Dev additionally provides Sandbox, animation/calibration/lighting labs and the Effects Playground. Player packages exclude developer screens and inspection APIs.

## Develop and verify

Use Node 24.18.0 and npm 11.16.0. Dependencies are pinned.

Start the browser game:

```sh
npm ci
npm run dev
```

Controls: WASD move · Mouse aim · LMB sword · RMB lantern · Shift dodge · Escape pause.

Run `npm run check` for regular verification: full tests, assets, types, repository boundaries, architecture, documentation, formatting and whitespace. For complete host verification on macOS or Windows, run `npm run verify:full`; it adds both Game/Dev builds, packages and E2E. Already verified packages can use `npm run test:e2e` directly. [Contributing](CONTRIBUTING.md#e2e-coverage-and-execution-budgets) owns platform coverage and execution budgets.

CI runs regular gates and both builds. Main pushes and manual runs also package and run E2E. The [release runbook](docs/release.md#build-and-package-pinned-outputs) gives the separate build, identity and prebuilt packaging commands. Explicit captures and benchmarks remain separate investigations.

For simultaneous agent tasks, use one worktree per task and follow [parallel task ownership](CONTRIBUTING.md#parallel-task-ownership). Select the checked-in Codex local environment for dependency/hook setup and assign distinct preview ports.

For visual scene composition, run `npm run scene:editor`. The [scene editor guide](docs/scene-editor.md) covers placement, drafts, live edits, saving and recovery.

For existing-artwork scene iteration:

```sh
npm run scene:dev -- --scene court
npm run scene:check -- --scene court
npm run check:task -- --scene court --capture
```

Use `upper-landing` for the Ruined Chapel. The shared preview restores developer context on reload. The task check includes the full regular gates and a short scene journey; inspect its three retained stills and the edited location for a visual redesign. [Contributing](CONTRIBUTING.md#verification) owns when to use full desktop journeys and exhaustive investigations.

Development, tests and builds automatically obtain the exact prepared asset revision pinned in `assets/lock.json`. Verified assets live in the operating system cache outside the checkout and are reusable offline. Code-only work and hosted CI do not need the source Asset Library.

During iteration, `npm test -- tests/hero-actions.test.ts` runs exactly that suite; omit file arguments for the full test run. [Contributing](CONTRIBUTING.md#test-value) describes test value. [Foundation recipes](docs/foundation.md#change-recipes) identify owners and checks for saves, content and action changes.

`npm run desktop` starts Game; `npm run desktop:dev` starts Sandbox; `npm run desktop:preview` starts Dev Game Preview; `npm run desktop:effects` starts the playground.

## Artwork workflow

Originals remain in the shared, iCloud-backed Asset Library under Documents. On an art-authoring machine, `npm run assets:prepare` creates and validates selected outputs. `npm run assets:finalize` validates the matching prepared pack and retains captures for agent visual review. When payload bytes differ, inspect the captures and run `npm run assets:finalize -- --reviewed <review-id>` to publish/pin those exact reviewed bytes through GitHub Releases. Fresh byte-identical preparations instead complete by reusing the archive and pinning current provenance. Both paths verify ordinary pinned consumption. Follow the [completion steps](docs/assets.md#local-preparation-review). Requested runtime-asset work includes this completion step; `assets:publish` is a compatibility alias. These are explicit authoring operations; ordinary builds never regenerate artwork.

The source library can be reorganized: sources are recovered automatically by recorded hashes. Canonical reference images and Clean INK prompts remain unchanged. [Asset ownership](docs/assets.md) and [source recovery](docs/source-recovery.md) describe the contracts.

## Retention and diagnostics

The external disposable cache has a 4 GiB budget. Unused entries are evicted automatically; active commands are protected. `npm run assets:clean` explicitly deletes published packs unreferenced by this checkout’s pin, remote main, open PR heads or supported releases. Pins unique to another local checkout are not included in that reference scan. Supported game tags are listed in `assets/supported.json`.

Successful checks print concise summaries and discard routine captures. Failures retain bounded diagnostics; `--capture` explicitly requests screenshots/video exports. Smoke windows are hidden and non-focusable by default; `--visible` enables a normal window. Hidden checks do not certify visible display pacing.

Explicit review, session recording and benchmark commands retain bounded comparison/reproduction inputs in the external disposable cache. They print the exact file location; cache eviction can remove old evidence. Keep a needed baseline in an external workspace, never in Git.

Major accomplishments and upcoming work are tracked in the [roadmap](docs/roadmap.md). Current game behavior, architecture and developer tools are documented in [design intent](docs/game-design.md), [foundation](docs/foundation.md), [lighting](docs/lighting-lab.md) and [effects](docs/effects-playground.md).

For a locally prepared replacement, append `--local` to asset-backed tests, checks, builds and smoke commands. This verifies the unpublished preparation without changing the shared pack pin. `npm run smoke:animation -- --local --capture` explicitly retains bounded current-kit comparison evidence.

## Documentation

| Question | Owner |
| --- | --- |
| What is implemented and what comes next? | [Roadmap](docs/roadmap.md), [design intent](docs/game-design.md) |
| Where does behavior live and how do I change it? | [Foundation and change recipes](docs/foundation.md) |
| How do I verify or investigate changes? | [Contributing](CONTRIBUTING.md), [handoff and benchmarks](docs/handoff.md) |
| How do I record and reproduce a session? | [Session replay](docs/session-replay.md) |
| How do I author or recover assets? | [Assets](docs/assets.md), [source recovery](docs/source-recovery.md) |
| What contracts should new audio follow? | [Audio implementation contract](docs/audio.md) |
| How do I inspect lighting and effects? | [Lighting lab](docs/lighting-lab.md), [Effects Playground](docs/effects-playground.md) |
| How do I deliver a supported public release? | [Release runbook](docs/release.md) |

Keep rules in these owners and link to them; `package.json` owns the exhaustive command inventory. [Agent rules](AGENTS.md) own artwork and repository boundaries.
