# Lantern Knight

The opening has two playable areas: Graveyard Approach (one skeleton) and Ruined Chapel (two). Game and Dev share the renderer, combat, session and persistence lifecycle. Dev additionally provides Sandbox, animation/calibration/lighting labs and the Effects Playground. Player packages exclude developer screens and inspection APIs.

## Prototype iteration

Start independent work in an isolated worktree with the intended baseline. Run `npm run task:start -- <name> --paths <paths...>` before editing; refresh relevant owners, contracts, checks and evidence with `npm run agent:context -- [paths...]`. [Contributing](CONTRIBUTING.md#verification) owns the normal workflow; detailed policies load only when relevant.

## Develop and verify

Use Node 24.18.0 and npm 11.16.0. Dependencies are pinned.

Start the browser game:

```sh
npm ci
npm run dev
```

Controls: WASD move · Mouse aim · LMB sword · RMB lantern · Shift dodge · Escape pause.

Use the [verification workflow](CONTRIBUTING.md#verification) for scoped checks, focused tests and targeted browser probes. CI and explicit integration commands own exhaustive/platform coverage; [release](docs/release.md#build-and-package-pinned-outputs) owns delivery. [Task coordination](docs/task-coordination.md#parallel-task-ownership) owns simultaneous worktrees and preview ports.

For visual scene composition, run `npm run scene:editor`. The [scene editor guide](docs/scene-editor.md) covers placement, drafts, live edits, saving and recovery.

For existing-artwork scene iteration:

```sh
npm run scene:dev -- --scene court
npm run scene:probe -- --scene court
```

Use `upper-landing` for the Ruined Chapel. The shared preview restores developer context on reload. Use `scene:check` for targeted acceptance and `--capture` only for an explicit visual investigation; visually inspect a redesign. [Scene verification](docs/verification.md#scene-workflow) defines the evidence boundary.

Development, tests and builds automatically obtain the exact prepared asset revision pinned in `assets/lock.json`. Verified assets live in the operating system cache outside the checkout and are reusable offline. Code-only work and hosted CI do not need the source Asset Library.

During iteration, `npm test -- tests/hero-actions.test.ts` runs exactly that suite; omit file arguments to select affected suites automatically. Use `npm run test:full` for all suites. Prototype scene layouts are not frozen by gameplay fixtures; full visual/delivery journeys are explicit. [Contributing](CONTRIBUTING.md#test-value) describes test value. [Foundation recipes](docs/foundation.md#change-recipes) identify owners and checks for saves, content and action changes.

`npm run desktop` starts Game; `npm run desktop:dev` starts Sandbox; `npm run desktop:preview` starts Dev Game Preview; `npm run desktop:effects` starts the playground.

## Artwork workflow

Originals remain in the iCloud-backed Asset Library. Prototype imports finish with source-verified `assets:dev -- --ids <asset-id>`, preserving the published pin. [Asset iteration and explicit delivery](docs/assets.md#local-preparation-review) own preparation, visual review, publication and pinning. Ordinary builds/CI consume prepared assets and never regenerate artwork.

The source library can be reorganized: sources are recovered automatically by recorded hashes. Canonical reference images and Clean INK prompts remain unchanged. [Asset ownership](docs/assets.md) and [source recovery](docs/source-recovery.md) describe the contracts.

## Retention and diagnostics

The external disposable cache has a 4 GiB budget. Unused entries are evicted automatically; active commands are protected. `npm run assets:clean` explicitly deletes published packs unreferenced by this checkout’s pin, remote main, open PR heads or supported releases. Pins unique to another local checkout are not included in that reference scan. Supported game tags are listed in `assets/supported.json`.

Successful verification prints compact scope/counts and an external details path; reused evidence does not claim fresh execution. Details retain selected suites, reasons and timings without rerunning checks. `agent:context` reports current/stale/failed/expired evidence. Routine captures are discarded. Failures retain bounded diagnostics; `--capture` explicitly requests screenshots/video exports. Smoke windows are hidden and non-focusable by default; `--visible` enables a normal window. Hidden checks do not certify visible display pacing.

Explicit review, session recording and benchmark commands retain bounded comparison/reproduction inputs in the external disposable cache. They print the exact file location; cache eviction can remove old evidence. Keep a needed baseline in an external workspace, never in Git.

Major accomplishments and upcoming work are tracked in the [roadmap](docs/roadmap.md). Current game behavior, architecture and developer tools are documented in [design intent](docs/game-design.md), [foundation](docs/foundation.md), [lighting](docs/lighting-lab.md) and [effects](docs/effects-playground.md).

For a locally prepared replacement, append `--local` to asset-backed tests, checks, builds and smoke commands. This verifies the unpublished preparation without changing the shared pack pin. `npm run smoke:animation -- --local --capture` explicitly retains bounded current-kit comparison evidence.

## Documentation

| Question                                         | Owner                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| What is implemented and what comes next?         | [Roadmap](docs/roadmap.md), [design intent](docs/game-design.md)                       |
| Where does behavior live and how do I change it? | [Foundation and change recipes](docs/foundation.md)                                    |
| How do I verify or investigate changes?          | [Contributing](CONTRIBUTING.md), [handoff and benchmarks](docs/handoff.md)             |
| How do I record and reproduce a session?         | [Session replay](docs/session-replay.md)                                               |
| How do I author or recover assets?               | [Assets](docs/assets.md), [source recovery](docs/source-recovery.md)                   |
| What contracts should new audio follow?          | [Audio implementation contract](docs/audio.md)                                         |
| How do I inspect lighting and effects?           | [Lighting lab](docs/lighting-lab.md), [Effects Playground](docs/effects-playground.md) |
| How do I deliver a supported public release?     | [Release runbook](docs/release.md)                                                     |

Keep rules in these owners and link to them; `package.json` owns the exhaustive command inventory. [Agent rules](AGENTS.md) own artwork and repository boundaries.
