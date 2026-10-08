# Contributing

Use the pinned Node/npm versions in [README](README.md#develop-and-verify). [Agent rules](AGENTS.md) own artwork and repository boundaries. Inspect status and relevant diffs before editing, preserve unrelated work, and re-read shared files when another session may have changed them. Use one worktree per independent editing task; commit and push only when requested; requested runtime-asset changes include publication and pinning under the asset workflow.

Keep working checkouts outside cloud-synchronized folders, such as in `~/Developer`, so disposable dependencies and build outputs are not synchronized. The shared Asset Library remains separately backed up in iCloud under Documents; its location is independent of the checkout.

## Push protection

Run `npm run hooks:install` once in each clone to enable the tracked pre-push hook. It checks the tip commit of each outgoing ref against that commit’s `assets/lock.json`, even with unrelated working-tree edits. It rejects a stale tip pin before upload without reading source artwork or downloading packs; it does not check every intermediate commit. `npm run assets:pin:check` checks committed HEAD, and `npm run assets:pin:check -- <commit-sha>` checks a specific committed snapshot. Neither command validates uncommitted recipe or pin changes. This guard supplements the regular checks; it does not certify asset quality or hosted CI.

Changed runtime asset recipes finish through [asset finalization](docs/assets.md#local-preparation-review), including validation and pinning without a second user request. Byte-identical fresh preparations reuse the published archive and record accepted provenance; changed payloads require agent visual review and publication. Committing or pushing the updated pin remains separately authorized. Local `--local` checks alone cannot certify a push against the published pack.

## Verification

| Moment | Checks and evidence |
| --- | --- |
| During iteration | Use `npm run scene:dev -- --scene court` for scene work and run the suites that exercise the changed behavior, for example `npm test -- tests/hero-actions.test.ts tests/systems.test.ts`. |
| Task handoff | For a scene task, run `npm run check:task -- --scene court`; add `--capture` for a visual redesign and inspect the edited location. Other tasks run `npm run check`: full tests, assets, types, repository boundaries, architecture, documentation, formatting and `git diff --check`. |
| Delivery changes | Add the affected Game/Dev builds, identity checks, packaging or smoke journeys from [release](docs/release.md#build-and-package-pinned-outputs) and the workflow. These supplement the regular gates. |
| Hosted CI | [The workflow](.github/workflows/ci.yml) owns the exact checks. Pull requests run the full regular suite and both builds; main pushes and manual runs also package and run shared macOS E2E plus focused Windows integration. |

### Regular checks

`check` runs the regular gates sequentially and includes documentation and formatting validation. It reports each passed, failed or skipped gate, stops dependent work after failure, and retains bounded failure evidence in the external cache. The regular check has one five-minute execution deadline across setup and all gates; nested phases use the remaining time. Use `npm run check -- --local` only for an intentional unpublished preparation; the full test scope is unchanged. Builds, packaging and smoke remain separate delivery checks.

After the final edit, run the task handoff once. Repeat checks after new edits, failures or a concrete unresolved concern. Regular gates and scene startup/acceptance report phase times; managed commands report queue admission separately.

Tests, handoff checks and builds fingerprint authored inputs before and after execution. Tracked and nonignored untracked code, tests, configuration, recipes, pins and documentation participate; source discovery does not walk the Asset Library, installed dependencies or generated packs. Changed inputs invalidate the result. Builds stamp the starting source digest only after stability checks and remove the identity file on failure. Source archives retain a digest without Git attribution.

Only completed checks establish verification. Report what ran, its result and material limitations; full local checks do not imply hosted CI or visible playtest success. [Handoff](docs/handoff.md) owns delivery and performance evidence. Keep enduring rules in their owner documents and completed results in handoffs and Git history, without adding historical reports to the checkout.

### Scene workflow

Scene tasks use the production presentation in a disposable browser Sandbox. Automated checks use the already installed Electron Chromium runtime as an isolated Vite browser host, without building or packaging the game. `scene:dev` opens an existing room and reuses a matching preview on loopback port 5174 by default; it refuses another checkout or asset revision. Set `LANTERN_PREVIEW_PORT` to a distinct integer from 1 to 65535 for each active worktree. Scene preview, editor, acceptance and benchmark commands share this setting, including nested checks. Reuse the same port for that task throughout its handoff; incompatible or occupied ports fail without stopping another server. Generated build/package outputs are excluded from preview watching so unrelated builds do not reload the scene. Reload restores per-tab scene, supported hero position, camera span, quality, lighting, mode and pause state without writing checkpoints. `--local` selects an unpublished preparation for all three scene commands. Stop task-owned previews when finished; another session's shared preview remains running.

`scene:check` runs construction, entry/traversal, foreground policy, surround viewport/composition, room-resource lifetime and reload checks. Surround timing sampling runs separately with `npm run scene:benchmark -- --scene court`. Its deterministic traversal drives the simulation directly with enemies disabled; it does not exercise player input, combat or checkpoint storage. It starts a temporary preview when none exists and closes only that preview. `--capture` retains three native-resolution scene stills externally; assertions alone do not establish visual approval. `check:task` runs full regular gates and the selected browser scene check against stable authored inputs, then gives one scoped summary. Packaged input/persistence journeys are still required for changed player interactions, and desktop integration needs desktop checks. Ordinary existing-artwork scene edits do not require packaging, publication, exhaustive capture matrices or videos.

Targets on a warm Mac are three seconds edit-to-preview, sixty seconds scene acceptance and ninety seconds task verification; these are measured goals, not weakened correctness gates.

### Parallel task ownership

Use one worktree per independent editing task and nominate one integration owner. That owner may also coordinate asset preparation/publication. Shared-checkout subagents are suitable for read-only reviews or explicitly assigned nonoverlapping edits; they must re-read shared files before editing. Start worktrees from the intended common baseline rather than an unrelated remote default. Worktree branches use the `codex/` prefix when a branch is needed; Git commits and pushes still require the user's request.

For a dirty starting checkout, keep its existing changes intact and stabilize a single working-tree snapshot before starting dependent tasks. Use Codex's working-tree starting option to include those changes; a plain Git worktree starts from committed files and does not copy them. Record the common snapshot identity and each task's changes relative to it, rather than attributing the inherited dirty set to every task. Never reset, stash or clean another owner's work to create a baseline. Integrate reviewed task-only patches when commits are not authorized.

Each task's chat carries this brief; temporary ownership/status records stay out of Git:

- Goal and completion criteria, including affected player behavior.
- Baseline commit and, when dirty, the common snapshot identity.
- Owned files/scene documents/source groups and agreed shared interfaces.
- Focused tests, required scene/delivery checks, and the assigned preview port.
- Integration owner, asset owner when applicable, and dependencies on other tasks.

Split work by coherent features with explicit file ownership. Simulation/session/save/input live in core, gameplay and scene definitions in content, rendering/lighting/effects in presentation, and preparation/delivery/cache in asset tools. A change crossing these boundaries needs an agreed contract first. Assign one owner per scene document, shared catalog, save schema, dependency change or asset recipe. Worktree isolation prevents overwrites, but does not resolve incompatible IDs, timing, schema or rendering assumptions.

Codex's [local environment](.codex/environments/environment.toml) runs `npm ci` and enables the tracked hooks for new worktrees. Install the pinned Node/npm versions before setup and select this environment when creating the worktree. Dependencies, Vite caches, build outputs and packages belong to each worktree; do not share a writable dependency directory. Published packs use the existing external cache, so ordinary worktree setup does not copy artwork, prepare assets or build the game. See [official local-environment guidance](https://learn.chatgpt.com/docs/environments/local-environment).

Assign port 5174 to the integration checkout and distinct available ports such as 5175 and 5176 to task worktrees. Export the task's port in each terminal before using scene commands:

```sh
export LANTERN_PREVIEW_PORT=5175
npm run scene:dev -- --scene court
npm run scene:editor
npm run check:task -- --scene court
```

These commands reuse the same task preview when its checkout and artwork match. The editor writes only that preview checkout's scene documents. Stop previews the task started before archiving its worktree. Preserve unintegrated patches, commits and required local files before cleanup; do not archive another owner's workspace automatically.

Owners hand off their task-only diff, baseline, completed checks and remaining limitations. The integration owner applies ready changes sequentially, reviews cross-feature contracts and runs the required combined regular and affected scene/delivery checks. Passing task checks certify only their own snapshot. Freeze the checkout being verified; agents in other worktrees may continue editing. In a shared checkout, all writers must pause until verification completes.

### Concurrent commands

Support up to three concurrent coding/review agents on this Mac by sharing one expensive-command lane on loopback port 48158 across Lantern checkouts. Managed commands validate names, options and test selections before contacting the lane. Full checks, standalone type/architecture checks, tests, builds, packaging, smoke/benchmarks and asset commands acquire admission before asset setup, source fingerprinting or output changes. Selected files are rechecked after admission; invalid requests create no command artifacts. Busy commands report the active command, PID, checkout and elapsed time, then wait up to five minutes; cancellation or wait timeout starts no work.

One command supervisor holds admission and reuses each verified asset workspace throughout a composite task. Composite tasks call operations directly; necessary test/browser subprocesses reuse a credential verified against the live owner. The OS releases the listener after termination. Managed command cancellation terminates only its owned process tree before releasing admission. Use the npm entry points so the command supervisor also covers preparation and packaging.

Execution deadlines start after admission: unit tests retain at most two workers, a two-minute suite deadline and a five-minute aggregate run deadline. Managed verification runs in a supervised process tree; setup and nested operations share the remaining execution budget. These limits do not reserve resources against Alchemy, Trinket or manually launched tools. Asset leases continue to protect cache data independently.

Agents can read, edit and review independently while expensive commands wait. Use focused suites during iteration and nominate one agent to run final verification while writers keep that checkout stable. Share one preview server within each worktree; dev commands hold admission only through asset startup, then release it while serving. Close task-owned previews when finished. Game, Sandbox and Effects windows keep foreground rendering quality and redraw hidden or unfocused scenes at most once per second, without advancing background gameplay. Focus restores rendering but does not unpause gameplay. Managed smoke/benchmark launches explicitly retain continuous rendering even when hidden or unfocused.

### Test selection

File selections must name existing top-level `tests/*.test.ts` files; directories, globs, unknown options and missing paths fail before any suite runs. Equivalent paths and duplicates run a suite once. The runner reports the selected files and aggregate counts; a passing focused run establishes only that scope. No arguments run every suite.

Pure suites run without reading the pack pin or acquiring artwork. Mixed runs execute pure suites first, then acquire one workspace for runtime-asset suites; unclassified suites require assets. Suite requirements belong to [the test runner](tools/test.ts). Systems, foundation, lighting and animation sampling use pure gameplay or small synthetic fixtures. The separate compiler suite creates its fixtures lazily; focused foundation/gameplay runs do not compile artwork; compatible-page leases do not require artwork. Native sprite/room binding checks remain asset-backed. Unit summaries report each suite duration; immutable fixture inputs may be reused, while mutable simulations, rooms and histories remain isolated. Append `--local` only when intentionally testing an unpublished preparation under the [asset workflow](docs/assets.md#local-preparation-review).

Nested runner checks use an isolated single-test fixture and clear inherited Node worker context; zero executed checks fail.

### Documentation checks

`docs:check` reads tracked and nonignored untracked Markdown files, checks local inline/reference links and Markdown heading anchors, validates documented npm commands and explicit backticked repository paths, and requires durable root/docs documents to be reachable from README or AGENTS. Authored reference provenance is outside the reachability requirement. Commands in examples are checked; links and path examples inside fences and comments are ignored. It does not fetch remote links, inspect the Asset Library, or establish that prose matches runtime behavior.

## Code formatting

Run `npm run format` to format all handwritten TypeScript, JavaScript, CSS, HTML and Python, or `npm run format:check` to validate it. Prettier 3.9.9 is npm-pinned; Ruff 0.16.10 is installed as a standalone binary in a leased, bounded external cache entry on first use. First use requires Python/pip and network access; later checks reuse that entry offline. Formatting does not lint Python or rewrite embedded shader strings. Authored JSON, canonical references, dependency locks and generated data are excluded. Configuration lives in [.prettierrc.json](.prettierrc.json) and [ruff.toml](ruff.toml).

Managed command definitions belong to [the task registry](tools/task-runner.ts): aliases, arguments, asset setup, deadlines and execution share one owner. Formatting checks also verify managed npm entries against that registry.

## Test value

Permanent tests must protect a named, consequential failure: incorrect combat outcomes, lost or duplicated progress, broken checkpoint protection, blocked input, stale asynchronous work, resource lifetime failures or violated asset/delivery contracts. Use the cheapest layer that detects the failure; browser/Electron coverage must identify the real input, renderer, filesystem or application integration it protects. Extend existing protection before adding another journey.

Avoid implementation-shaped assertions, incidental markup, cosmetic enumeration and redundant matrices. Test counts, coverage percentages and arbitrary LOC quotas are not improvement targets. No new test is appropriate when existing protection is adequate. In review, identify the protected failure, why the layer is necessary, overlapping protection and the added execution/setup, test code and resource cost. Changes to expensive suites need measured before/after timings and a concise account of surviving coverage.

Consolidate or retire overlapping tests within the task after checking their purpose and known regressions. Never delete or weaken a test to hide a product failure. Moving valuable regression protection into an optional slow suite does not satisfy this policy. Preserve production visual fidelity, animation timing and sound behavior; optimize the harness and assertion layer.

Coverage has one owner per failure: hero-actions owns sword timing, buffering, interruption and dodge; systems owns input projection and session transitions; persistence owns every supported save migration and storage protection. Foundation owns animation notifications, fixed-clock replay and resource leases. Hero-art owns native registration/clip bindings, and Graveyard/Crypt own construction, contact and fades. Editor history owns transactional placement, attachment and light-capacity rejection. Task-runner and command-lane own preflight, deadlines and cancellation; replay/build-proof checks call importable operations with focused CLI success/failure coverage.

The mandatory asset gate owns the exhaustive lighting-companion inventory and hashes each companion file once. Pure lighting coverage rejects missing, stale and unexpected bindings. Packaged Sandbox verifies that local reveal leaves transparent margins empty and keeps opaque/soft-edge coverage disjoint. Ordinary pixel comparisons read canvas pixels in the browser; PNG encoding is reserved for requested captures and failure evidence. Crypt keeps exact full-render/batched parity, every subpixel ownership sample, a short foreground/dodge sequence and intermediate allocation checks. Long motion traces and galleries are requested diagnostics. Player preferences own zoom, quality and effect reload in an isolated profile; the Game journey owns gameplay and checkpoints.

### E2E coverage and execution budgets

`npm run test:e2e` consumes verified Game/Dev packages. macOS runs shared gameplay, renderer and developer integration coverage; Windows runs focused platform integration. `npm run verify:full` runs regular gates, both builds, both host packages and that host's E2E coverage in one managed invocation. Both accept `--local` for an intentional unpublished preparation. Full host verification does not establish another platform's behavior.

| Execution scope | Hard budget |
| --- | --- |
| CI checks, including install, regular gates, both builds and upload | 2 minutes |
| Each dependent desktop job, including install, download, identities, both packages and E2E | 7 minutes |
| Shared macOS E2E, including package validation and application startup | 5 minutes |
| Windows integration E2E, including package validation and application startup | 2 minutes |
| Complete local host verification, including asset setup, builds and packages | 9 minutes |

Target eight minutes for the complete CI execution path. The two-minute checks job plus the longest seven-minute desktop job caps execution at nine minutes; runner queues are reported separately. Local admission waiting is also separate. Deadlines fail verification, terminate owned processes and retain bounded failure logs. Setup and nested phases cannot reset an aggregate clock. Normal successful runs print phase times and slowest E2E phases, plus presentation-update and renderer-submission counts for inspectable Dev phases; compare summed runner time and launches as well as elapsed time. Keep the existing CI runner count, two unit workers and one local expensive-command lane.

| Protected risk | Surviving coverage |
| --- | --- |
| Combat, transitions, death/retry and checkpoint authorization | Shared packaged Game journey plus pure systems, application and persistence suites |
| Foot registration, support and framing | Existing hero-art, churchyard and scene-surround suites; native renderer checks remain on macOS |
| Frozen pixels, subpixel depth/occlusion and GPU resource lifetime | Shared Crypt, Sandbox and weather/effects assertions |
| Player effect contributions, settings without checkpoint writes and reload | Separate isolated player-preference profile |
| Developer effect contributions, deterministic baseline and mode routing | Effects assertions in a reused Dev process; mode changes use the production launch bridge |
| Windows package/input/storage/renderer compatibility | Both packages, real keyboard/mouse input, checkpoint process restart/load, preferences, both rooms, framebuffer/shader checks and Dev profile isolation |

The coordinated suite reuses the verified asset workspace and compatible Dev process, while keeping Game persistence profiles isolated. Windows does not duplicate the shared combat/composition matrix; platform-specific failures still require Windows protection. Routine scene matrix observation is replaced by lower-layer support/framing assertions; requested captures retain the exhaustive composition views. Native framebuffer, frozen-image, occlusion and effect-contribution assertions remain mandatory shared coverage.

Windows CI uses ANGLE/SwiftShader; the interaction checks select the existing 50% quality option. Crypt pose samples retain twenty state updates with one final submission and an exact full-render pixel control; resource-lifetime checks still draw intermediate frames. These automated checks do not establish visible pacing or exhaustive cross-platform renderer parity.

Prefer observable state/frame conditions over fixed sleeps. Real elapsed-time assertions may retain short, bounded waits. Benchmark sampling and exhaustive screenshot/video generation belong to explicit investigations, not ordinary regression runs. Lighting smoke samples performance only with `--benchmark` or `--benchmark-only`; its correctness and resource assertions remain ordinary checks. Asset preparation/publication is a separate authoring operation and retains the required candidate-specific validation in [assets](docs/assets.md#local-preparation-review).

During iteration run focused checks; after edits stabilize run final verification once. Repeat after new edits, failures or a concrete unresolved concern. Use the [foundation recipes](docs/foundation.md#change-recipes) for changes crossing owners and the [player-feedback principle](docs/game-design.md#player-action-feedback) during implementation and review.

## Review and investigation

Use `npm run review:status` for the complete dirty inventory, or `npm run review:diff -- <task-owned paths>` for selected patches. Both preserve the full inventory in a bounded external cache entry, including staged/unstaged layers, untracked files, deletions and renames. Read deferred patches before claiming complete review. Media and dependency-lock patches are omitted by default; authored asset pins and recipes remain reviewable. Use `--full` with a particular omitted path only when it is relevant. Review output is temporary evidence, not a checkout archive.

For a bug or audit candidate, establish the intended behavior or ownership rule, trace the actual consumers, and check counterevidence such as existing validation, compatibility needs or intentional variants. A confirmed finding needs a reachable failure or demonstrated contract/maintenance problem, its impact, a causal remedy, and verification capable of exposing the original problem. Prioritize progress loss, blocked play and wrong outcomes. Search hits, file size and passing gates alone do not establish findings; zero confirmed findings is a valid result.

Follow confirmed causes across affected callers, schemas, tests and docs within the requested scope. Prefer existing owners and the cheapest meaningful verification. Report inspected versus sampled scope, unresolved findings and unavailable checks. Keep enduring rationale in its canonical owner; completed results belong in the handoff and Git history. Audit guidance does not authorize unrelated product changes or create a standing backlog.

GitHub Actions stay pinned to full commit SHAs. Dependabot groups weekly Actions updates into reviewable PRs under `.github/dependabot.yml`; normal CI must pass before merging.

Document each rule once and link to its owner. Update changed behavior in place rather than appending dated corrections. [Foundation](docs/foundation.md#import-boundaries) owns import rules; [handoff](docs/handoff.md) owns performance evidence; [release](docs/release.md) owns public delivery.
