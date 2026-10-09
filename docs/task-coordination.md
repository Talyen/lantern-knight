# Task coordination

## Parallel task ownership

Use one worktree per independent editing task, based on the intended common commit or preserved dirty baseline. Agree owners for shared scene documents, schemas, dependencies and interfaces. Never reset, stash or clean another owner's work. Keep dependencies, builds and previews worktree-local; only immutable prepared assets share the external cache.

Before concurrent editing, run `git rev-parse --show-toplevel` and `git worktree list` to verify that the task uses a distinct checkout. A separate chat does not establish checkout isolation. If work began in the shared primary checkout, preserve its edits and carry only task-owned changes into a separate worktree before continuing independent editing.

Proceed independently once scope and contracts are clear. The user authorizes task-relevant coordination messages to other Codex chats; authorization is permission, not an expectation of continuous coordination. Message for a concrete dependency, overlapping scope, shared interface decision or final integration handoff. Avoid routine progress broadcasts, repeated editing-status inquiries and requests to pause another worktree for ordinary local checks. This authorization does not cover external communication services or separately controlled actions such as pushing, publication or deletion.

Assign distinct preview ports: integration uses 5174, worktrees can use 5175/5176. Set `LANTERN_PREVIEW_PORT` before development/browser commands. A probe verifies checkout and asset identity before reusing a server. Stop only previews the task started.

## Handoff and commits

The user gives standing authorization to commit task-owned reviewed/verified changes after integration into local `main`. Preserve inherited edits and other owners' staged work. Integrate coherent changes sequentially and verify the combined snapshot. Interdependent changes can use one coordinated atomic commit. Pushing remains separately authorized.

Finish and verify task-owned changes in the isolated worktree before handoff. With concurrent tasks, agree one current integration owner before modifying `main`; other chats continue worktree-local work and do not edit, stage, commit or finalize the primary checkout during that integration window. The owner reviews and integrates the completed changes, runs fresh `npm run check` on the combined snapshot, commits only reviewed task-owned paths and reports the result before handing integration ownership onward. No permanent coordinator or task registry is required.

Report integration status, local `main` checkout, commit hash/subject, completed checks and unavailable coverage. If integration is blocked or task changes cannot be separated safely, identify the concrete dependency. Worktree checks do not establish main integration or remote delivery.

## Concurrent commands

GPU checks and asset preparation share one local lane on loopback port 48158. Top-level operations acquire it; helpers do not borrow credentials or recursively acquire admission. Waiting reports contention and starts no work on cancellation/timeout. The OS releases the listener after process termination.

Let the lane and asset leases handle routine contention automatically. Do not negotiate verification windows through chat for normal waiting. Coordinate only when a specific lock, preview or resource problem requires another owner's action; identify the resource and blocking condition.

Pure tests, static checks and builds do not acquire the lane. Unit workers remain bounded at two and browser tests at one. Active asset leases independently protect cache data. Preserve foreground rendering quality; hidden/unfocused developer views throttle their own work and never advance background gameplay. Explicit automated rendering may retain continuous cadence.
