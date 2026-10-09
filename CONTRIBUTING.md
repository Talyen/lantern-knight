# Contributing

Use the pinned Node/npm versions in [README](README.md#develop-and-verify). Inspect relevant status and diffs, preserve unrelated edits, and re-read shared files before changing them. Future worktree task commits follow [handoff and commits](docs/task-coordination.md#handoff-and-commits); push only when requested.

## Push protection

Install tracked hooks once with `npm run hooks:install`. [Push protection](docs/verification.md#push-protection) checks outgoing committed asset pins; it does not certify uncommitted work or hosted CI.

## Verification

Prototype iteration is the default. Start independent work in an isolated worktree containing the intended baseline, then run `npm run task:start -- <name> --paths <paths...>` before editing. Existing dirty work becomes baseline. Discovery paths guide the brief without restricting checks. Refresh current owners, contracts, checks and evidence with `npm run agent:context -- [paths...]`.

Finish ordinary tasks with `npm run check`; use `npm test -- tests/<name>.test.ts` during iteration. For changed browser interactions, use one `scene:probe` or `ui:probe`. Asset prototypes finish with scoped `assets:dev`; publication/pinning through `assets:finalize` is explicit integration/delivery work. Run final focused verification once after edits stabilize, then repeat affected phases only after repairs or an unresolved concern.

### Regular checks

[Regular checks](docs/verification.md#regular-checks) own task deltas, conservative selection, evidence reuse and stability. `check:full` and `test:full` explicitly request full coverage; `verify:build` combines full checks and both builds, and `verify:full` adds host delivery coverage. A local result certifies only its reported scope; CI and visual approval remain separate.

### Scene workflow

[Scene workflow](docs/verification.md#scene-workflow) owns previews, targeted probes and scene acceptance. Capture only for an explicit visual investigation; assertions do not establish visual approval.

### Parallel task ownership

[Task ownership](docs/task-coordination.md#parallel-task-ownership) owns common dirty baselines, isolated worktrees, file/interface ownership and integration handoffs. Preserve task-only patches before cleanup.

### Concurrent commands

[Command admission](docs/task-coordination.md#concurrent-commands) owns the shared expensive-command lane, cancellation and preview lifetime. Cheap static checks and pure tests bypass it.

### Test selection

[Test selection](docs/verification.md#test-selection) owns exact suite arguments, pure/asset-backed classification and dependency fallbacks. Unknown executable dependencies remain conservative.

### Documentation checks

[Documentation checks](docs/verification.md#documentation-checks) validate paths, anchors, scripts and reachability. Document each rule once; link to its owner.

## Code formatting

[Formatting](docs/verification.md#code-formatting) owns scoped formatting and pinned tools.

## Linting and unused code

[Linting](docs/verification.md#linting-and-unused-code) owns TypeScript/Python checks and unused-code analysis.

## Test value

[Test value](docs/verification.md#test-value) owns regression quality. Protect consequential behavior and contracts; avoid tests that mirror reversible implementation details.

### E2E coverage and execution budgets

[Integration coverage](docs/verification.md#e2e-coverage-and-execution-budgets) owns packaged/platform journeys and execution budgets. Ordinary tasks do not routinely package apps, replay combat journeys or generate capture matrices.

## Review and investigation

`npm run review:status` shows subsystem counts and task-relevant changes; add `--all` for the complete inventory. `npm run review:diff -- <paths>` selects patches. Both retain complete staged/unstaged, untracked, deleted and renamed inventory externally. Read deferred patches before claiming complete review; `--full` exposes a particular omitted media/lock patch when relevant.

Successful verification prints compact scope/counts plus a detail-file path containing selections, reasons and timings. Reused evidence never claims fresh execution. Failures retain bounded logs and concise assertion diagnostics. Read the printed details without rerunning verification. External cache evidence may expire.

For a finding, establish intended behavior, trace consumers, check counterevidence and demonstrate reachable impact or a contract problem. Follow confirmed causes across affected callers, tests and canonical docs; report inspected versus sampled scope and unavailable checks. Zero confirmed findings is valid. Keep completed results in the handoff and Git history, rather than historical repository reports.

GitHub Actions remain pinned to full SHAs; grouped Dependabot updates require passing CI. [Foundation](docs/foundation.md#import-boundaries) owns import contracts, [handoff](docs/handoff.md) performance evidence, and [release](docs/release.md) public delivery.
