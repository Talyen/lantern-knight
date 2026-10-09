# Verification

## Regular checks

`npm run check` executes fresh typechecking, JavaScript linting, handwritten web-code formatting checks and all pure tests. It reports actual phase timings and fails on the first broken phase. No task snapshot, affected-suite guess or previous passing receipt can suppress a test.

`npm run check:ci` adds documentation, repository boundaries, import boundaries and unused-code analysis. These are inexpensive source checks, separate from asset acquisition, browser checks and packaging. Ordinary commands do not install Python tooling.

## Test selection

`npm test` runs every `tests/unit/*.test.ts` suite. Arguments name exact files in that group; duplicates run once and invalid selections fail before setup. `npm run test:watch` uses Node's watcher. Pure tests use small fixtures and require no source artwork or prepared pack.

`npm run test:assets` runs `tests/assets/*.test.ts` against pinned prepared assets. Python authoring/recovery fixtures belong to this tier. `npm run assets:check` validates current runtime manifests, references, pages and companion registration without source-library access or visual approval.

`npm run test:browser -- [scenario]` runs Playwright scenarios in `tests/browser`. Game covers input, pause/focus and current checkpoints; scene covers both rooms/reload/resource lifetime; editor covers authoring/history/recovery and protected save requests; effects covers startup. Local testing reuses a matching Vite server and rejects another checkout or asset identity. CI uses pinned assets and its own server. Add `-- --ui` for continuous interactive iteration.

`npm run test:desktop` consumes a Game package and tests the actual executable, bundled identity, real controls and storage restart. Native results apply to the platform exercised. Browser results do not certify desktop integration or visible reference-hardware pacing.

## Test value

Protect a consequential failure once at the cheapest sufficient layer. Prefer real state changes, failed operations, cancellation, re-entry and disposal over checking source text or mirroring implementation details. Remove coverage for removed machinery. Do not add retries to hide races or weaken an invariant to reach a timing target.

## Code formatting

`npm run format` and `npm run format:check` handle handwritten web code. Authored JSON and canonical art/reference files are not reformatted. Explicit Python formatting uses `npm run format -- --python`; set up the authoring environment first.

## Linting and unused code

`npm run lint` runs Oxlint with TypeScript awareness. `npm run knip` checks live entries and dependencies. Python authoring lint is explicit: run the environment's Ruff against `tools` and `tests`. Keep entry declarations aligned with real HTML, CLI, test and preparation consumers.

## Documentation checks

`npm run docs:check` validates local Markdown links/anchors, current npm commands and repository file references. Feature guides link to the relevant workflow or contract owner. The checker does not establish that prose matches behavior.

## E2E coverage and execution budgets

Routine Linux CI runs source gates, runtime asset validation, one Game build and Game/scene browser scenarios. Authoring-tool changes additionally run editor/effects scenarios with the authoring bundle. Desktop/build/dependency/asset-delivery contract changes select macOS and Windows jobs; explicit milestone dispatch also runs them. Native jobs build and package Game once on their host, with no cross-platform restoration format or mandatory Dev package. Scene/gameplay edits use routine CI.

CI has generous hang timeouts. Local GPU tests and asset preparation share a small admission lane; static checks, pure tests and builds do not. Default unit concurrency remains two and browser concurrency one. [Coordination](task-coordination.md#concurrent-commands) owns the shared-machine details.

## Diagnostics and measurements

`npm run benchmark -- game`, `lighting`, `crypt`, `graveyard`, `animation`, `hero`, `sandbox`, `effects`, `preferences` or `scenes` runs an explicit native investigation against the relevant package. Use `--capture` only when visual evidence is wanted. Retained output remains external. Native framebuffer, motion and resource assertions remain available through these scenarios; routine checks do not generate galleries.

Initial goals are three seconds for warm preview updates and ten seconds for ordinary checks; correctness remains required.

## Performance comparisons

Compare cold acquisition/startup separately from warm iteration, checks, builds and packaging. Use repeated equivalent samples; record hardware, assets, settings, sample duration, foreground/background policy and rendering quality. Count transferred bytes and repeated launches as well as elapsed time. Preserve needed baselines outside Git.

`npm run benchmark -- sandbox --benchmark` records renderer measurements; `npm run benchmark -- compare <baseline.json> <candidate.json>` compares retained external records. Renderer calculation changes require native output and exact pixel parity. Fewer submissions alone do not prove better visible pacing.

## Packaged player journey measurements

`npm run benchmark -- game --benchmark` exercises the actual Game package after explicit packaging. Preserve gameplay, animation timing, sound behavior and visual fidelity. Hidden/software runs do not certify 60 FPS on reference hardware or visible polish. See [Delivery](release.md) for packaging and [session replay](session-replay.md) for headless reproduction.
