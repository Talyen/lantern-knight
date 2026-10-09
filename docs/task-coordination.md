# Task coordination

## Parallel task ownership

Use one worktree per independent editing task and nominate one integration owner. That owner may also coordinate asset preparation/publication. Shared-checkout subagents are suitable for read-only reviews or explicitly assigned nonoverlapping edits; they must re-read shared files before editing. Start worktrees from the intended common baseline rather than an unrelated remote default. Worktree branches use the `codex/` prefix when a branch is needed; [Handoff and commits](#handoff-and-commits) owns task commit authorization; pushes require the user's request.

For a dirty starting checkout, keep its existing changes intact and stabilize a single working-tree snapshot before starting dependent tasks. Use Codex's working-tree starting option to include those changes; a plain Git worktree starts from committed files and does not copy them. Record the common snapshot identity and each task's changes relative to it, rather than attributing the inherited dirty set to every task. Never reset, stash or clean another owner's work to create a baseline. Integrate reviewed task-only patches while preserving inherited dirty work; follow the handoff commit policy below.

Each task's chat carries this brief; temporary ownership/status records stay out of Git:

- Goal and completion criteria, including affected player behavior.
- Baseline commit and, when dirty, the common snapshot identity.
- Owned files/scene documents/source groups and agreed shared interfaces.
- Focused tests, required scene/delivery checks, and the assigned preview port.
- Integration owner, asset owner when applicable, and dependencies on other tasks.

Split work by coherent features with explicit file ownership. Simulation/session/save/input live in core, gameplay and scene definitions in content, rendering/lighting/effects in presentation, and preparation/delivery/cache in asset tools. A change crossing these boundaries needs an agreed contract first. Assign one owner per scene document, shared catalog, save schema, dependency change or asset recipe. Worktree isolation prevents overwrites, but does not resolve incompatible IDs, timing, schema or rendering assumptions.

Codex's [local environment](../.codex/environments/environment.toml) runs `npm ci` and enables the tracked hooks for new worktrees. Install the pinned Node/npm versions before setup and select this environment when creating the worktree. Dependencies, Vite caches, build outputs and packages belong to each worktree; do not share a writable dependency directory. Published packs use the existing external cache, so ordinary worktree setup does not copy artwork, prepare assets or build the game. See [official local-environment guidance](https://learn.chatgpt.com/docs/environments/local-environment).

Assign port 5174 to the integration checkout and distinct available ports such as 5175 and 5176 to task worktrees. Export the task's port in each terminal before using scene commands:

```sh
export LANTERN_PREVIEW_PORT=5175
npm run scene:dev -- --scene court
npm run scene:editor
npm run check:task -- --scene court
```

These commands reuse the same task preview when its checkout and artwork match. The editor writes only that preview checkout's scene documents. Stop previews the task started before archiving its worktree. Preserve unintegrated patches, commits and required local files before cleanup; do not archive another owner's workspace automatically.

Owners hand off their task-only diff, baseline, completed checks and remaining limitations. The integration owner applies ready changes sequentially, reviews cross-feature contracts and runs the required combined regular and affected scene/delivery checks. Passing task checks certify only their own snapshot. Freeze the checkout being verified; agents in other worktrees may continue editing. In a shared checkout, all writers must pause until verification completes.

## Handoff and commits

For future worktree tasks, the user gives standing authorization to commit the task's reviewed, verified changes after integration into local `main`. Before final handoff, coordinate with the integration owner, apply only the task-owned changes, and verify they are present in the intended `main` checkout. Complete the required checks on a stable integrated snapshot, then make a task-scoped commit. Preserve inherited dirty work and other owners' staged edits; do not stage the entire checkout or unrelated portions of shared files. Pushing remains separately authorized.

If integration is pending, say so and identify the integration owner or blocker. If a valid task-only commit depends on uncommitted prerequisites or cannot be separated from another owner's edits, coordinate with the integration owner and report the blocker instead of committing incomplete or unrelated work. Worktree checks alone do not certify integration into `main`.

For interdependent tasks, the integration owner may make one agreed batch commit covering those tasks. Each agent verifies its changes are included and cites that commit in its handoff; it does not need a duplicate commit. This authorization does not include inherited dirty work outside the agreed tasks.

The final handoff must state:

- Integration status and the verified local `main` checkout.
- Commit hash and subject, or the specific reason no commit was made.
- Completed checks and any deferred coverage.

Example: “Integrated into local `main` at `<checkout>`; committed as `<hash>` (`<subject>`). Checks: `<scope>`; deferred: `<coverage>`.” Report remote delivery only after an authorized push succeeds.

## Concurrent commands

Support up to three concurrent coding/review agents on this Mac by sharing one expensive-command lane on loopback port 48158 across Lantern checkouts. Managed commands validate names, options and test selections before contacting the lane. Full checks, asset-backed tests, builds, packaging, GPU smoke/benchmarks and asset authoring acquire admission before expensive work. Cheap static checks and pure focused tests bypass this lane; they retain their own deadlines and bounded workers. Selected files are rechecked after admission; invalid requests create no command artifacts. Busy commands report the active command, PID, checkout and elapsed time, then wait up to five minutes; cancellation or wait timeout starts no work.

One command supervisor holds admission and reuses each verified asset workspace throughout a composite task. Composite tasks call operations directly; necessary test/browser subprocesses reuse a credential verified against the live owner. The OS releases the listener after termination. Managed command cancellation terminates only its owned process tree before releasing admission. Use the npm entry points so the command supervisor also covers preparation and packaging.

Execution deadlines start after admission: unit tests retain at most two workers, a two-minute suite deadline and a five-minute aggregate run deadline. Managed verification runs in a supervised process tree; setup and nested operations share the remaining execution budget. These limits do not reserve resources against Alchemy, Trinket or manually launched tools. Asset leases continue to protect cache data independently.

Agents can read, edit and review independently while expensive commands wait. Use focused suites during iteration and nominate one agent to run final verification while writers keep that checkout stable. Share one preview server within each worktree; dev commands hold admission only through asset startup, then release it while serving. Close task-owned previews when finished. Game, Sandbox and Effects windows keep foreground rendering quality and redraw hidden or unfocused scenes at most once per second, without advancing background gameplay. Focus restores rendering but does not unpause gameplay. Managed smoke/benchmark launches explicitly retain continuous rendering even when hidden or unfocused.
