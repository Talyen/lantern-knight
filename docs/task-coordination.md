# Task coordination

## Parallel task ownership

Use one worktree per independent editing task, based on the intended common commit or preserved dirty baseline. Agree owners for shared scene documents, schemas, dependencies and interfaces. Never reset, stash or clean another owner's work. Keep dependencies, builds and previews worktree-local; only immutable prepared assets share the external cache.

Assign distinct preview ports: integration uses 5174, worktrees can use 5175/5176. Set `LANTERN_PREVIEW_PORT` before development/browser commands. A probe verifies checkout and asset identity before reusing a server. Stop only previews the task started.

## Handoff and commits

The user gives standing authorization to commit task-owned reviewed/verified changes after integration into local `main`. Preserve inherited edits and other owners' staged work. Integrate coherent changes sequentially and verify the combined snapshot. Interdependent changes can use one coordinated atomic commit. Pushing remains separately authorized.

Report integration status, local `main` checkout, commit hash/subject, completed checks and unavailable coverage. If integration is blocked or task changes cannot be separated safely, identify the concrete dependency. Worktree checks do not establish main integration or remote delivery.

## Concurrent commands

GPU checks and asset preparation share one local lane on loopback port 48158. Top-level operations acquire it; helpers do not borrow credentials or recursively acquire admission. Waiting reports contention and starts no work on cancellation/timeout. The OS releases the listener after process termination.

Pure tests, static checks and builds do not acquire the lane. Unit workers remain bounded at two and browser tests at one. Active asset leases independently protect cache data. Preserve foreground rendering quality; hidden/unfocused developer views throttle their own work and never advance background gameplay. Explicit automated rendering may retain continuous cadence.
