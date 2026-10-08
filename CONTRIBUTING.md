# Contributing

Use the pinned Node/npm versions in [README](README.md#develop-and-verify). [Agent rules](AGENTS.md) own artwork and repository boundaries. Inspect status and relevant diffs before editing, preserve unrelated work, and re-read shared files when another session may have changed them. Use the current checkout; commit, push or publish only when requested.

## Verification

| Moment | Checks and evidence |
| --- | --- |
| During iteration | Run the suites that exercise the changed behavior, for example `npm test -- tests/hero-actions.test.ts tests/systems.test.ts`. |
| Task handoff | Run `npm run check`: full tests, assets, types, repository boundaries, architecture, documentation and `git diff --check`. |
| Delivery changes | Add the affected Game/Dev builds, identity checks, packaging or smoke journeys from [README](README.md#develop-and-verify) and the workflow. These supplement the regular gates. |
| Hosted CI | [The workflow](.github/workflows/ci.yml) owns the exact checks. Pull requests run checks and both builds; main pushes and manual runs also package and smoke-test macOS and Windows. |

`check` runs the existing gates sequentially and always includes documentation validation. It reports each passed, failed or skipped gate, stops dependent work after failure, and retains bounded failure evidence in the external cache. Each gate has a five-minute deadline. Use `npm run check -- --local` only for an intentional unpublished preparation; the full test scope is unchanged. Builds, packaging and smoke remain separate delivery checks.

Tests, handoff checks and builds fingerprint authored inputs before and after execution. Tracked and nonignored untracked code, tests, configuration, recipes, pins and documentation participate; source discovery does not walk the Asset Library, installed dependencies or generated packs. Changed inputs invalidate the result. Builds stamp the starting source digest only after stability checks and remove the identity file on failure. Source archives retain a digest without Git attribution.

Support up to three concurrent coding/review agents on this Mac by sharing one expensive-command lane on loopback port 48158 across Lantern checkouts. Full checks, standalone type/architecture checks, tests, builds, packaging, smoke/benchmarks and asset commands acquire admission before asset setup, source fingerprinting or output changes. Busy commands report the active command, PID, checkout and elapsed time, then wait up to five minutes; cancellation or wait timeout starts no work. Nested managed commands reuse a credential verified against the live owner. The OS releases the listener after termination. Execution deadlines start after admission: unit tests retain at most two workers, a two-minute suite deadline and a five-minute run deadline, and check gates retain their five-minute deadlines. These limits do not reserve resources against Alchemy, Trinket or manually launched tools. Asset leases continue to protect cache data independently. Managed command cancellation terminates only its owned process tree before releasing admission. Use the npm entry points so the command supervisor also covers preparation and packaging.

Agents can read, edit and review independently while expensive commands wait. Use focused suites during iteration and nominate one agent to run final verification while all agents keep authored inputs stable. Share one preview server; dev commands hold admission only through asset startup, then release it while serving. Close task-owned previews when finished. Game, Sandbox and Effects windows keep foreground rendering quality and redraw hidden or unfocused scenes at most once per second, without advancing background gameplay. Focus restores rendering but does not unpause gameplay. Managed smoke/benchmark launches explicitly retain continuous rendering even when hidden or unfocused.

File selections must name existing top-level `tests/*.test.ts` files; directories, globs, unknown options and missing paths fail before any suite runs. Equivalent paths and duplicates run a suite once. The runner reports the selected files and counts; a passing focused run establishes only that scope. No arguments run every suite. Append `--local` only when intentionally testing an unpublished preparation under the [asset workflow](docs/assets.md#local-preparation-review).

`docs:check` reads Git-listed Markdown files, checks local inline/reference links and Markdown heading anchors, validates documented npm commands and explicit backticked repository paths, and requires durable root/docs documents to be reachable from README or AGENTS. Authored reference provenance is outside the reachability requirement. Commands in examples are checked; links and path examples inside fences and comments are ignored. It does not fetch remote links, inspect the Asset Library, or establish that prose matches runtime behavior.

Only completed checks establish verification. Report what ran, its result and material limitations; full local checks do not imply hosted CI or visible playtest success. [Handoff](docs/handoff.md) owns delivery and performance evidence. Keep enduring rules in their owner documents and completed results in handoffs and Git history, without adding historical reports to the checkout.

## Test value

Choose permanent tests for a concrete, consequential failure: incorrect combat outcomes, lost or duplicated progress, broken checkpoint protection, blocked interactions, stale asynchronous work, resource lifetime failures or violated asset/delivery contracts. Prefer the cheapest layer that can detect the failure. Strengthen an existing test when it already reaches the case; use browser/Electron journeys when actual input, renderer or persistence integration is the risk.

Avoid tests that merely repeat implementation, assert incidental markup, enumerate cosmetic variants or duplicate existing protection. Test counts and coverage percentages are not improvement targets. Adding no test is appropriate when existing protection is adequate; explain material verification limits.

When touching overlapping tests, consider consolidation or retirement after checking their purpose and known regressions. Never delete or weaken a test to hide a product failure. Report material coverage changes and surviving protection. Keep cleanup within the task rather than starting an unrelated suite audit.

Use the [foundation recipes](docs/foundation.md#change-recipes) for changes crossing owners and the [player-feedback principle](docs/game-design.md#player-action-feedback) during implementation and review.

## Review and investigation

Use `npm run review:status` for the complete dirty inventory, or `npm run review:diff -- <task-owned paths>` for selected patches. Both preserve the full inventory in a bounded external cache entry, including staged/unstaged layers, untracked files, deletions and renames. Read deferred patches before claiming complete review. Media and dependency-lock patches are omitted by default; authored asset pins and recipes remain reviewable. Use `--full` with a particular omitted path only when it is relevant. Review output is temporary evidence, not a checkout archive.

For a bug or audit candidate, establish the intended behavior or ownership rule, trace the actual consumers, and check counterevidence such as existing validation, compatibility needs or intentional variants. A confirmed finding needs a reachable failure or demonstrated contract/maintenance problem, its impact, a causal remedy, and verification capable of exposing the original problem. Prioritize progress loss, blocked play and wrong outcomes. Search hits, file size and passing gates alone do not establish findings; zero confirmed findings is a valid result.

Follow confirmed causes across affected callers, schemas, tests and docs within the requested scope. Prefer existing owners and the cheapest meaningful verification. Report inspected versus sampled scope, unresolved findings and unavailable checks. Keep enduring rationale in its canonical owner; completed results belong in the handoff and Git history. Audit guidance does not authorize unrelated product changes or create a standing backlog.

GitHub Actions stay pinned to full commit SHAs. Dependabot groups weekly Actions updates into reviewable PRs under `.github/dependabot.yml`; normal CI must pass before merging.

Document each rule once and link to its owner. Update changed behavior in place rather than appending dated corrections. [Foundation](docs/foundation.md#import-boundaries) owns import rules; [handoff](docs/handoff.md) owns performance evidence; [release](docs/release.md) owns public delivery.
