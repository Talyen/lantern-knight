# Task coordination

## Parallel task ownership

Use one isolated worktree and task branch per implementation chat, starting from committed local `main` unless the user specifies another base. Reuse a suitable worktree. Verify `git rev-parse --show-toplevel` and `git worktree list` before editing; a separate chat does not establish isolation. Preserve unrelated edits and unfinished work in every checkout. If work began in the primary checkout, carry only task-owned changes into an isolated worktree before continuing. Keep dependencies, builds and previews worktree-local; only immutable prepared assets share the external cache.

Zero inter-chat messages is the default. Do not discover or poll chats to establish isolation, negotiate routine ownership, announce startup, broadcast progress/completion, request verification windows or acknowledge messages. Repository evidence and automatic locks handle ordinary work. Task-relevant messaging is authorized only for a concrete unresolved dependency or conflict that cannot be answered from the repository. Keep the exchange bounded and actionable; do not reply merely to acknowledge. This permission covers Codex chats only, not external communication services.

After reporting completion to the user, stop. Finished chats leave the coordination loop: do not message, poll or wake them unless the user explicitly asks to resume them. An unsolicited routine message is not a new task and requires no response or renewed coordination. Do not create recurring coordination monitors or follow-ups.

Assign distinct preview ports: integration uses 5174, worktrees can use 5175/5176. Set `LANTERN_PREVIEW_PORT` before development/browser commands. A probe verifies checkout and asset identity before reusing a server. Stop only previews the task started.

## Handoff and commits

The user authorizes task-scoped branch/worktree creation, commits and local integration into `main` after review and required verification. Each chat owns its task through completion. Commit only reviewed task-owned changes on the task branch. Preserve inherited edits and other owners' staged work. After successful local integration, the user authorizes deleting and unregistering only this chat's completed worktree, including local-only files and build outputs, as described below. Asset publication follows the task-scoped exception in [Assets](assets.md#preparation-and-publication). Pushes, PRs, publication other than task-scoped asset packs, other destructive cleanup and unrelated changes require separate authorization; explicit task restrictions take precedence.

After reviewing and committing the task, run `npm run task:integrate` from its clean `codex/` worktree. This is the complete integration operation: acquire the shared lock, checkpoint eligible editor saves in `main`, merge current `main` into the task branch, run fresh [change-aware checks](verification.md#regular-checks) on the combined changes, then fast-forward clean local `main` to the verified commit. The command checks task and main again before advancing main. Let this command own final routine verification; a separate pre-integration repetition is unnecessary. Complete any additional browser, native or visual validation required by the change before integration.

Merge conflicts stop in the task worktree for review and resolution. Commit understood resolutions, then rerun the command. Other failures preserve the task and leave main unadvanced, except for eligible editor-save checkpoints already made. Never reset or stash unrelated work to integrate. If blocked, leave the reviewed task committed and report the concrete limitation; do not start a chat coordination loop.

Successful integration deletes and unregisters only the invoking completed task worktree, including ignored files and build outputs, while retaining its branch. Keep captures outside disposable checkouts. Use `npm run task:integrate -- --keep-worktree` when a preview, experiment or requested work still needs the checkout. Cleanup failures are reported separately from completed integration. Report the main checkout, commit hash/subject, checks, unavailable coverage and cleanup result, then stop.

### Lock and recovery

The existing `npm run integration:lock -- [--keep-worktree] <command> [args...]` remains available for specialized integration commands. It runs the command in the checkout holding `main`. Keep the entire merge, verification and fast-forward sequence in one foreground invocation. All automated main writers use this cooperative lock; nested locks are rejected. Ordinary tasks use `task:integrate` instead of writing scripts.

Admission uses an exclusive loopback listener derived from the physical Git common directory, shared by all worktrees. It waits up to 30 minutes, announces contention once, and starts no command on cancellation or timeout. Missing main fails before execution. Ordinary completion, failure and interruption release admission after owned subprocess cleanup.

When main contains only valid saved scenes under `authoring/scenes/`, new immutable revisions under `authoring/ground-profiles/`, or valid `authoring/asset-reviews.json` decisions, admission checkpoints their exact bytes in a separate commit. Staged work, invalid content, deletions and other dirty files stop integration. Concurrent saves remain preserved and require a retry.

Cleanup requires the unchanged task branch/commit to equal main, a clean checkout without unfinished Git operations or submodules, and an unlocked registration. It first moves the checkout to a temporary directory under `~/.codex/worktree-archives/<repository>/`, unregisters it, then deletes the temporary directory. Failed unregistration restores the checkout; other failures report its location and `recovery.json`. `CODEX_WORKTREE_ARCHIVE_ROOT` can select an external staging directory; cross-filesystem moves fail without deleting the source. Never stage inside the repository. Restore a retained branch with `git worktree add <path> <branch>`; successfully deleted local-only files are not retained.

## Concurrent commands

GPU checks and asset preparation share one local lane on loopback port 48158, separate from integration admission. Top-level operations acquire it; helpers do not borrow credentials or recursively acquire admission. Waiting reports contention and starts no work on cancellation/timeout. The OS releases the listener after process termination.

Let the lane and asset leases handle routine contention automatically. Do not negotiate verification windows through chat for normal waiting. Message only when a concrete resource problem requires another owner's action and repository evidence cannot resolve it; identify the resource and blocking condition.

Pure tests, static checks and builds do not acquire the GPU lane. Unit workers remain bounded at two and browser tests at one. Active asset leases independently protect cache data. Preserve foreground rendering quality; hidden/unfocused developer views throttle their own work and never advance background gameplay. Explicit automated rendering may retain continuous cadence.
