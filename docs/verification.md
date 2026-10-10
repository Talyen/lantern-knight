# Verification

## Regular checks

`npm run check` executes fresh typechecking, JavaScript linting, handwritten web-code formatting checks and the reviewed fast pure suites. It reports actual phase timings and fails on the first broken phase. Every selected suite runs fresh; no task snapshot, affected-suite guess or previous passing receipt suppresses it.

`npm run check:ci` runs all pure suites with `--full` and adds documentation, repository boundaries, import boundaries and unused-code analysis. These are inexpensive source checks, separate from asset acquisition, browser checks and packaging. Ordinary commands do not install Python tooling.

## Test selection

`npm test` and `npm run test:watch` default to fast `tests/unit/*.test.ts` suites. `npm test -- --full` runs all pure suites; `npm run test:watch -- --full` watches them all. The small explicit CI-default list in `tools/test.ts` records expensive suites and their reasons; missing entries fail selection rather than silently losing coverage. New pure suites run locally unless deliberately classified. Arguments name exact files, including CI-default suites; duplicates run once and invalid selections fail before setup. Use `--full` without exact files or `--assets`. Pure tests use small fixtures and require no source artwork or prepared pack.

Routine local testing should take roughly ten seconds including setup. This is a guideline, not a timeout or permission to omit failures. Optimize useful slow tests or route them to CI by default. Asset, browser and desktop checks are explicit integration commands, outside routine local checks. Agents may run full or slow coverage locally for a specific reproduction, diagnosis or validation need: state the reason, choose the smallest relevant scope and avoid repeating unchanged successful runs. Changed browser behavior needs appropriate CI scenarios; report whether they actually ran, including pending or unavailable coverage.

Authored scenes are disposable content: gameplay and rendering regressions own their setup, and authored-document validation accepts an empty scene directory.

`npm run test:assets` runs `tests/assets/*.test.ts` against pinned prepared assets. Python authoring/recovery fixtures belong to this tier. `npm run assets:check` validates current runtime manifests, references, pages and companion registration without source-library access or visual approval.

`npm run test:browser -- [scenario]` runs Playwright scenarios in `tests/browser`. Game covers input, pause/focus and current checkpoints; scene covers independent outdoor/interior fixtures, reload and resource lifetime; editor covers authoring/history/recovery and protected save requests; effects covers dedicated-scene controls and switching back to independent scene fixtures. One preview session acquires assets and starts a server, or reuses a matching Vite server after checking checkout, asset identity and required scope. It closes only its own server and lease. CI uses pinned assets and its own server. Add `-- --ui` for continuous interactive iteration.

After `npm run build`, `npm run test:browser -- game --built` verifies Game against the production web artifact with its recorded asset identity. It checks artifact bytes before starting a dedicated preview, without reopening the asset cache. Scene/editor/effects scenarios retain development previews because production Game excludes those views. Rebuild the web artifact after packaging before using `--built`.

`npm run test:desktop` consumes a Game package and tests the actual executable, bundled identity, real controls and storage restart. Native results apply to the platform exercised. Browser results do not certify desktop integration or visible reference-hardware pacing.

## Test value

Write and retain only high-value tests: detecting a plausible, significant failure must justify the effort to write and maintain the test and the time to run it, including setup. This applies across gameplay, saves, rendering, assets, tooling and delivery. There is no test-count quota or line-coverage target.

Before adding a test, identify the failure it catches and inspect existing protection. Extend an existing test when that provides clear coverage more cheaply. Zero new tests is appropriate when existing coverage is sufficient or a proposed test offers insufficient value. Do not add medium- or low-value coverage: trivial implementation assertions, redundant cases, source-text checks where behavioral proof is available, or speculative edge cases without meaningful consequences.

Protect a consequential failure once at the cheapest sufficient layer. Prefer observable state changes, failed operations, cancellation, re-entry and disposal. Keep expensive integration tests only for failures cheaper tests cannot meaningfully catch. Consolidate overlap, strengthen or remove weak tests, and remove coverage for removed machinery; preserve meaningful known-regression, exact rendering and resource-lifetime protection when its value justifies the cost. Review a plausible broken implementation against the assertion before claiming protection.

Do not add retries to hide races, silently skip failures or weaken an invariant to reach a timing target. Test value is a review judgment; duration alone does not establish it.

## Code formatting

`npm run format` and `npm run format:check` handle handwritten web code. Authored JSON and canonical art/reference files are not reformatted. Explicit Python formatting uses `npm run format -- --python`; set up the authoring environment first.

## Linting and unused code

`npm run lint` runs Oxlint with TypeScript awareness. `npm run knip` checks live entries and dependencies. Python authoring lint is explicit: run the environment's Ruff against `tools` and `tests`. Keep entry declarations aligned with real HTML, CLI, test and preparation consumers.

## Documentation checks

`npm run docs:check` validates local Markdown links/anchors, current npm commands and repository file references. Feature guides link to the relevant workflow or contract owner. The checker does not establish that prose matches behavior.

## E2E coverage and execution budgets

Routine Linux CI runs source gates with all pure suites, all asset tests (including Python authoring/recovery fixtures), runtime asset validation, one Game web build, Game against that artifact and scene against a development preview with authoring assets. Scene checks include the shared asset browser; only Game scenarios use runtime-only assets. Authoring-tool changes additionally run editor/effects scenarios with the authoring bundle. Desktop/build/dependency/asset-delivery contract changes select macOS and Windows jobs; explicit milestone dispatch also runs them. Native jobs build and package Game once on their host, with no cross-platform restoration format or mandatory Dev package. Scene/gameplay edits use routine CI.

CI has generous hang timeouts. Local GPU tests and asset preparation share a small admission lane; static checks, pure tests and builds do not. Default unit concurrency remains two and browser concurrency one. [Coordination](task-coordination.md#concurrent-commands) owns the shared-machine details.

## Diagnostics and measurements

`npm run benchmark -- game`, `lighting`, `animation`, `hero`, `sandbox`, `effects`, `preferences` or `scenes` runs an explicit native investigation against the relevant package. Use `--capture` only when visual evidence is wanted. Retained output remains external. Native framebuffer, motion and resource assertions remain available through these scenarios; routine checks do not generate galleries.

Initial goals are three seconds for warm preview updates and ten seconds for ordinary checks; correctness remains required.

## Performance comparisons

Compare cold acquisition/startup separately from warm iteration, checks, builds and packaging. Use repeated equivalent samples; record hardware, assets, settings, sample duration, foreground/background policy and rendering quality. Count transferred bytes and repeated launches as well as elapsed time. Preserve needed baselines outside Git.

`npm run benchmark -- sandbox --benchmark` records renderer measurements; `npm run benchmark -- compare <baseline.json> <candidate.json>` compares retained external records. Benchmarks require a package matching current desktop build inputs and the selected asset pin; records keep source and build identities separately. Harness-only edits do not require recompilation. Renderer calculation changes require native output and exact pixel parity. Fewer submissions alone do not prove better visible pacing.

## Packaged player journey measurements

`npm run benchmark -- game --benchmark` exercises the actual Game package after explicit packaging. Preserve gameplay, animation timing, sound behavior and visual fidelity. Hidden/software runs do not certify 60 FPS on reference hardware or visible polish. See [Delivery](release.md) for packaging and [session replay](session-replay.md) for headless reproduction.
