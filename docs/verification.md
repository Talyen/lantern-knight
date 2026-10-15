# Verification

## Regular checks

Choose the command for the evidence needed:

| Command | Coverage |
| --- | --- |
| `npm run check` | Typechecking, JavaScript/TypeScript linting, handwritten code formatting and fast pure suites. Required after edits stabilize. |
| `npm run docs:check` | Documentation links, anchors, script names, file references and guide reachability. Also required for prose edits. |
| `npm run check:ci` | All regular source checks, all pure suites, documentation, repository/import boundaries and unused-code analysis. |

`check` and `check:ci` run each selected phase fresh, report timings and fail on the first broken phase. Previous passing results never suppress a selected suite. These commands do not acquire artwork, run browser or desktop checks, package the application or install Python tooling. `check:ci` can run locally; it does not establish a hosted CI result. Follow [test selection](#test-selection) for those integration tiers and [documentation checks](#documentation-checks) for prose accuracy limits.

## Test selection

`npm test` and `npm run test:watch` default to fast `tests/unit/*.test.ts` suites. `npm test -- --full` runs all pure suites; `npm run test:watch -- --full` watches them all. The small explicit CI-default list in `tools/test.ts` keeps fresh-process replay/build proofs and real-Git integration-lock proofs in full CI coverage; it records each reason, and missing entries fail selection rather than silently losing coverage. New pure suites run locally unless deliberately classified. Arguments name exact files, including CI-default suites; duplicates run once and invalid selections fail before setup. Use `--full` without exact files or `--assets`. Pure tests use small fixtures and require no source artwork or prepared pack.

Compiler fixtures use a 32 × 36 canvas and 64-pixel atlas. One tiny multi-page packing case checks RGB alpha synthesis and asymmetric pixels at every published rectangle, protecting row/page rollover, orientation and channel order in a single encoding pass. Determinism and failed builds compare both manifest and page bytes, including a missing later frame after an earlier frame has been packed. Keep these behavioral checks when changing fixture sizes; large uniform images add cost without exercising more encoding behavior. HTTP identity fixtures close their completed connections explicitly instead of waiting for keep-alive expiry.

Routine local testing should take roughly ten seconds including setup. This is a guideline, not a timeout or permission to omit failures. Optimize useful slow tests or route them to CI by default. Asset, browser and desktop checks are explicit integration commands, outside routine local checks. Agents may run full or slow coverage locally for a specific reproduction, diagnosis or validation need: state the reason, choose the smallest relevant scope and avoid repeating unchanged successful runs. Changed browser behavior needs appropriate CI scenarios; report whether they actually ran, including pending or unavailable coverage.

Authored scenes are disposable content: gameplay and rendering regressions own their setup, and authored-document validation accepts an empty scene directory. The asset tier validates saved documents through `checkSceneDocuments`; pure tests cover placement rejection with small fixtures instead of repeating a sweep of mutable editor saves.

`npm run test:assets` runs `tests/assets/*.test.ts` against pinned prepared assets. Authored scene documents validate against authoring assets independently of Game selection. Python authoring/recovery fixtures belong to this tier and require Pillow. CI installs Pillow 11.3.0 in a temporary environment before the tests; test commands do not install dependencies. For local asset tests on macOS/Linux, create or reuse a checkout-local environment and activate it so subprocesses find Pillow:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install Pillow==11.3.0
npm run test:assets
```

The fixtures invoke `python3`, which must resolve to the environment containing Pillow. Full [asset preparation](assets.md#local-preparation-review) needs additional authoring dependencies; the local selection models have [separate setup](developer-tools.md#local-foreground-selection-setup). `npm run assets:check` validates current runtime manifests, references, pages and companion registration without source-library access or visual approval.

`npm run test:browser -- [scenario]` runs Playwright scenarios in `tests/browser`:

| Selector                             | Coverage                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `game` (or `game-loot` for labels)   | Input, pause/focus, current checkpoints and distant loot-label routing.                                                     |
| `scene`                              | Independent outdoor/interior fixtures, reload and resource lifetime.                                                        |
| `editor`                             | Authoring, history, recovery, ground interaction, contact shadows and protected save requests.                              |
| `effects`                            | Dedicated-scene controls and switching back to independent scene fixtures.                                                  |
| `audio`                              | Game audio-setting persistence, prepared-sample decoding and Dev Preview audition controls.                                 |
| `image-delivery`, `ground-occlusion` | Focused GPU behavior.                                                                                                       |
| `authored-ground`                    | Opt-in [movement and timing capture](developer-tools.md#authored-scene-timing-capture), selected by `LANTERN_GROUND_SCENE`. |
| `ground-review`                      | Opt-in [occlusion captures](developer-tools.md#authored-occlusion-captures), selected by `LANTERN_GROUND_REVIEW`.           |
| `orchard-design`, `orchard-polish`   | Opt-in [opening composition and effect captures](developer-tools.md#opening-comparison-captures), with external output directories. |

Without a selector, Playwright selects all browser suites; the four capture suites skip unless their opt-in environment variables are set. Selectors match filenames, so `editor` includes the editor regression, ground, contact and gameplay-authoring suites. Development-only UI and renderer lifetime regressions belong to `scene`; the built Game runs cannot import their failure-injection modules. Add `--list` to inspect the selected cases without acquiring assets, taking the GPU lane or starting a preview; built-Game discovery needs no existing build. Multiple selectors can share one run, for example `npm run test:browser -- scene image-delivery ground-occlusion audio`.

Use `npm run test:browser -- --ci-development` for the complete development-browser CI tier, adding `--authoring` to include editor/effects suites. This selection excludes Game and opt-in captures; run `game --built` separately against a production web build. The same `--list` discovery option works with tier selection.

The `audio` suite always checks Game settings. Its decoding and audition test skips when the selected assets contain no prepared samples. To validate unpublished sounds locally, use a checkout-local [audio preparation](assets.md#audio-preparation) and leave `CI` unset; pinned CI cannot establish coverage for those samples. Browser decoding and playback assertions do not establish an audible mix; follow [listening and tuning](sound-design.md#listening-and-tuning).

Development-preview browser checks prefer checkout-local prepared assets, falling back to the pin. One preview session acquires assets and starts a server, or reuses a matching Vite server after checking checkout, asset identity and required scope. It closes only its own server and lease. With `CI=true`, browser checks use pinned assets and require an unused port for their own server; use this mode for [milestone verification](release.md). Install Chromium once with `npx playwright install chromium` when needed; Linux hosts may also need Playwright's `--with-deps` installation. Add `--ui` after the scenario for continuous interactive iteration, for example `npm run test:browser -- editor --ui`.

After `npm run build`, `npm run test:browser -- game --built` verifies Game against the production web artifact with its recorded asset identity. It checks artifact bytes before starting a dedicated preview, without reopening the asset cache. Scene/editor/effects scenarios retain development previews because production Game excludes those views. Game packaging replaces the web identity with a combined desktop identity; run `npm run build` again before using `--built` after Game packaging.

`npm run test:desktop` consumes a Game package and tests the actual executable, bundled identity, real controls and storage restart. The live-development fixture copies sources and installed dependencies into an isolated checkout, excluding generated dependency caches; CI verifies fresh installation once before these tests. Native results apply to the platform exercised. Browser results do not certify desktop integration or visible reference-hardware pacing.

Non-watch `npm test` and `npm run test:assets` omit individual passing cases while streaming summaries, failure details, skips, TODOs, stdout and stderr through Node's spec reporter. `--verbose` restores passing-case output; watch mode always includes it. Reporting does not change suite selection or failure exit status. Browser and desktop tests use their own reporters.

## Test value

Write and retain only high-value tests: detecting a plausible, significant failure must justify the effort to write and maintain the test and the time to run it, including setup. This applies across gameplay, saves, rendering, assets, tooling and delivery. There is no test-count quota or line-coverage target.

Before adding a test, identify the failure it catches and inspect existing protection. Extend an existing test when that provides clear coverage more cheaply. Zero new tests is appropriate when existing coverage is sufficient or a proposed test offers insufficient value. Do not add medium- or low-value coverage: trivial implementation assertions, redundant cases, source-text checks where behavioral proof is available, or speculative edge cases without meaningful consequences.

Protect a consequential failure once at the cheapest sufficient layer. Prefer observable state changes, failed operations, cancellation, re-entry and disposal. Keep expensive integration tests only for failures cheaper tests cannot meaningfully catch. Consolidate overlap, strengthen or remove weak tests, and remove coverage for removed machinery; preserve meaningful known-regression, exact rendering and resource-lifetime protection when its value justifies the cost. Review a plausible broken implementation against the assertion before claiming protection.

Do not add retries to hide races, silently skip failures or weaken an invariant to reach a timing target. Test value is a review judgment; duration alone does not establish it.

## Code formatting

`npm run format` and `npm run format:check` handle handwritten JavaScript/TypeScript, CSS and HTML in the repository root, `src/`, `electron/`, `tools/` and `tests/`. Markdown, authored JSON and canonical art/reference files are not reformatted. Explicit Python formatting uses `npm run format -- --python`, which also formats the regular code selection; set up the authoring environment first. Use `npm run format:check -- --python` to check both without writing.

## Linting and unused code

`npm run lint` runs Oxlint with TypeScript awareness. `npm run knip` checks live entries and dependencies. Python authoring lint is explicit: after installing Ruff 0.16.10 in the checkout's `.venv`, run `node --import tsx tools/lint.ts py`. This uses the repository's handwritten-file selection and Ruff configuration; `--fix` applies supported fixes. Python formatting uses [the explicit Python option](#code-formatting). Keep entry declarations aligned with real HTML, CLI, test and preparation consumers.

## Documentation checks

Run `npm run docs:check` after documentation edits; `npm run check` does not include it, while `npm run check:ci` does. It validates local Markdown links/anchors, npm script names, repository file references and reachability of root/docs guides from README or AGENTS. It does not validate command arguments, external links or whether prose matches behavior. Check those claims against the relevant source owner. Feature guides link to the relevant workflow or contract owner.

## E2E coverage and execution budgets

Routine Linux CI runs all pure suites and source gates first, then starts independent Game, development-browser and selected asset/native jobs. Two Game shards each build the production web artifact and split three complete player journeys covering controls, adventure travel and distant loot-label routing. Twelve development-browser shards use `--ci-development` to cover scene, audio, image delivery and ground occlusion; authoring-tool and shared browser-fixture changes add `--authoring` for editor/effects journeys. The wrapper discovers every browser suite and rejects names without a CI tier before starting a preview, preventing new regression files from silently falling outside the workflow. The four explicit capture suites (`authored-ground`, `ground-review`, `orchard-design`, `orchard-polish`) remain opt-in. Each runner keeps one browser worker and uses Playwright test-level sharding, so long files split across isolated runners without concurrent scene saves in one checkout.

Browser previews acquire verified pinned files on demand instead of downloading the complete authoring library. Game builds retain their verified selected-file delivery. Full asset tests (including Python authoring/recovery fixtures) and runtime asset validation run for asset, content, presentation, animation, authored-data, dependency and delivery-tool changes. Unrelated editor, gameplay, prose and CI-policy changes omit this full-library tier. Every Game build still verifies its selected assets. Manual workflow dispatch runs all optional tiers.

Desktop/build/dependency/asset-delivery contract changes select macOS and Windows jobs. Native jobs start after source gates, alongside browser jobs, and build/package Game once on their host. They retain packaged player storage/input and live-development reload/restart coverage.

Automatic screenshot, video and trace recording is off. Individual suites can still write explicit screenshots and attachments; opt-in authored-scene reviews retain their requested captures. These outputs live under `.cache/browser-results/`, which Playwright clears at the next run. Copy evidence needed across runs to an external directory first. Failure artifacts include the job and shard in their names.

[The CI workflow](../.github/workflows/ci.yml) defines the executed jobs, and [coverage policy](../tools/coverage-policy.ts) owns optional asset/authoring/desktop selection. An unavailable comparison base selects all optional tiers. The final `checks` job fails when any selected job fails or is cancelled; intentionally omitted tiers may skip. Report the jobs that actually ran; path classification alone does not establish coverage.

The target is under ten minutes of routine elapsed CI time; sharding does not establish that result until measured on hosted runners. Cold full-library validation, native packaging and runner queue delays may exceed it. Hang deadlines remain separate from that target. Local GPU tests and asset preparation share a small admission lane; static checks, pure tests and builds do not. Default unit concurrency remains two and browser concurrency one. [Coordination](task-coordination.md#concurrent-commands) owns the shared-machine details.

## Diagnostics and measurements

The `benchmark` command routes several kinds of diagnostic. [Recorded session replay](session-replay.md) covers the headless `record` and `replay` modes; `compare` reads saved measurement records. `walking` is the default quick native measurement; `editor` runs the browser editor scenario. `quality` checks prepared asset metadata, source-density declarations and texture budgets without launching a renderer or requiring a package; it does not establish visual quality. These modes are separate from the native scenarios below.

Native diagnostics consume an already packaged application; they do not build it. Prepare the matching package on the host before running a scenario:

| Scenarios after `npm run benchmark --`                                          | Required package                      |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| `startup`, `walking`, `game`, `preferences`                                     | Game: `npm run package -- --unsigned` |
| `sandbox` (alias `scene`), `lighting`, `animation`, `hero`, `effects`, `scenes` | Dev: `npm run package -- --dev`       |

Use `--local` on both packaging and the diagnostic when investigating a local asset preparation. `--visible` shows the native window; hidden/software runs do not establish visible pacing. Use `--capture` when visual evidence is wanted, or `--output /external/investigation` to retain results without requesting captures. Successful managed diagnostics normally discard their output; keep comparison records in an external directory. Native framebuffer, motion and resource assertions remain available through these scenarios; routine checks do not generate galleries.

Initial goals are three seconds for warm preview updates and ten seconds for ordinary checks; correctness remains required.

## Performance comparisons

Compare cold acquisition/startup separately from warm iteration, checks, builds and packaging. Use repeated equivalent samples; record hardware, assets, settings, sample duration, foreground/background policy and rendering quality. Count transferred bytes and repeated launches as well as elapsed time. Preserve needed baselines outside Git.

`npm run benchmark -- sandbox --benchmark --output /external/renderer-baseline` retains renderer measurements in that directory’s `benchmark.json`; `npm run benchmark -- compare <baseline.json> <candidate.json>` compares retained external records. Benchmarks require a package matching current desktop build inputs and the selected asset pin; records keep source and build identities separately. Harness-only edits do not require recompilation. Renderer calculation changes require native output and exact pixel parity. Fewer submissions alone do not prove better visible pacing.

## Quick walking measurements

After `npm run package -- --unsigned`, run `npm run benchmark` for one hidden hardware-rendered walking sample: one second of warmup, then five seconds holding forward in the current Game starting scene at the display’s logical dimensions and render scale 1, with depth of field at 100% and every player visual-effect toggle enabled. The command retains `benchmark.json` outside Git and prints its path, actual framebuffer dimensions, GPU, refresh rate, FPS, p50/p95/p99 and worst frame intervals, intervals over 25 ms, and absolute/normalized hitch (≥50 ms) and stall (≥100 ms) counts. Use `npm run benchmark -- --output /external/walking-baseline` to choose a retained directory. `npm run benchmark -- walking` is equivalent. Add `--visible` for a borderless fullscreen confirmation run (simple fullscreen on macOS), with the complete viewport fitted to the display. Hidden and visible records cannot compare with each other.

On macOS the quick path requests ANGLE Metal and rejects software fallback. Quick results and temporary profiles use a separate external `-measurements` cache capped at 256 MiB, avoiding artwork-cache scans on every run. The packaged executable supplies all assets; pin lookup does not acquire artwork payloads. The quick path skips the loading-media, menu and checkpoint journey checks. It verifies actual movement, hardware GPU observations, foreground sampling for visible runs and stable settings/source inputs. It consumes a matching package and rejects stale builds; packaging is explicit and outside the measurement time budget. It fails immediately if the GPU lane is occupied. The hidden default has a 27-second subprocess deadline and one-second termination grace for a 30-second command budget on a prepared, uncontended host. Visible confirmation permits up to 60 seconds for fullscreen setup and validation. A busy machine can prevent a result within that budget; the command prints total wall time on success or failure. Do not substitute software rendering or reduced resolution to meet the time goal.

For a visible run at a reported 59–61 Hz refresh rate, the provisional target is at least 59 FPS, p95 ≤18 ms, p99 ≤20 ms, no hitches and no stalls. Hidden runs and other refresh rates report the 60 Hz target as inconclusive. Frame callbacks measure cadence, not GPU execution or display presentation; a five-second sample cannot rule out rare stutters. Repeat matching runs before claiming an improvement. `compare` accepts walking records but refuses comparisons with the full journey or different conditions.

## Packaged player journey measurements

`npm run benchmark -- startup --samples 5 --visible --output /external/startup` measures fresh-process Game startup for empty storage and checkpoints in each current area, then verifies immediate attack, dodge, movement and lantern activation through the saved gameplay state. `--scenario fresh` restricts the run to empty storage. It records launch and document observations, overlapping registration/image/companion/GPU stages, resource timings, build identity, hardware and first-action frame cadence. `--baseline-executable /path/to/baseline` alternates matching baseline/candidate samples. Baseline packages must use the same asset pin; candidates must match current desktop inputs. Use 20 samples per scenario for a p95 below 10 seconds acceptance claim on reference Windows hardware. Fresh profiles do not establish an OS-cold disk cache, and macOS observations do not qualify Windows. Full quality and real input acceptance remain required.

`npm run benchmark -- game --benchmark` exercises movement, action inputs and checkpoint operations in the selected Game package after explicit packaging. It does not measure encounters, connected-area traversal or death/retry. Its fixed movement and action journey does not establish combat performance for the authored encounters. Preserve gameplay, animation timing, sound behavior and visual fidelity. Hidden/software runs do not certify 60 FPS on reference hardware or visible polish. See [Delivery](release.md) for packaging and [session replay](session-replay.md) for headless reproduction.
