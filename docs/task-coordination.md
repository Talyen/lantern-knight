# Task coordination

## Parallel task ownership

Use one isolated worktree and task branch per implementation chat, starting from committed local `main` unless the user specifies another base. Reuse a suitable worktree. Verify `git rev-parse --show-toplevel` and `git worktree list` before editing; a separate chat does not establish isolation. Preserve unrelated edits and unfinished work in every checkout. If work began in the primary checkout, carry only task-owned changes into an isolated worktree before continuing. Keep dependencies, builds and previews worktree-local; only immutable prepared assets share the external cache.

Zero inter-chat messages is the default. Do not discover or poll chats to establish isolation, negotiate routine ownership, announce startup, broadcast progress/completion, request verification windows or acknowledge messages. Repository evidence and automatic locks handle ordinary work. Task-relevant messaging is authorized only for a concrete unresolved dependency or conflict that cannot be answered from the repository. Keep the exchange bounded and actionable; do not reply merely to acknowledge. This permission covers Codex chats only, not external communication services.

After reporting completion to the user, stop. Finished chats leave the coordination loop: do not message, poll or wake them unless the user explicitly asks to resume them. An unsolicited routine message is not a new task and requires no response or renewed coordination. Do not create recurring coordination monitors or follow-ups.

Assign distinct preview ports: integration uses 5174, worktrees can use 5175/5176. Set `LANTERN_PREVIEW_PORT` before development/browser commands. A probe verifies checkout and asset identity before reusing a server. Stop only previews the task started.

## Handoff and commits

The user authorizes task-scoped branch/worktree creation, commits and local integration into `main` after review and required verification. Each chat owns its task through completion. Commit only reviewed task-owned changes on the task branch. Preserve inherited edits and other owners' staged work. After successful local integration, the user authorizes deleting and unregistering only this chat's completed worktree, including local-only files and build outputs, as described below. Agents may publish task-scoped asset packs when ready under [Assets](assets.md#preparation-and-publication), without separate approval. Pushes, PRs, publication other than task-scoped asset packs, other destructive cleanup and unrelated changes require separate authorization; explicit task restrictions take precedence.

Use `npm run integration:lock -- <command> [args...]` from the task worktree to run the complete integration command in the checkout holding local `main`. The command acquires an exclusive loopback listener derived from the repository's physical Git common directory, so all its worktrees share one lock. Hash collisions with another repository serialize harmlessly. It waits automatically for up to 30 minutes, announces contention once and starts no command on timeout or cancellation. Missing `main` fails before the command starts. When the only changes in `main` are valid saved JSON files under `authoring/scenes/`, new immutable revisions under `authoring/ground-profiles/`, and valid `authoring/asset-reviews.json` decisions, integration first checkpoints their exact bytes in a separate commit while holding the lock. Scene saves and asset review decisions need no user cleanup. Staged work, invalid scenes, deletions and changes outside those content directories still stop integration before the command starts. The task then incorporates the checkpoint and verifies the combined result; scene conflicts require resolution. Concurrent saves remain preserved and stop integration for a retry. Ordinary command completion, failure and interruption release the lock after owned subprocess cleanup. Nested integration commands are rejected. No permanent coordinator, task registry or chat handoff is required.

Hold the lock throughout these steps: incorporate current `main` into the task branch, resolve understood conflicts there, review the combined result, run fresh `npm run check` (and `npm run docs:check` for prose), then fast-forward clean local `main` to the verified task commit. Supply one foreground command or script containing the entire sequence; separate lock invocations do not protect intervening commands. Do not background integration work, edit the primary checkout outside the lock or acquire the lock merely to launch another agent. This is a cooperative lock: all automated writers to `main` must use it.

For a clean, committed task branch, an integration script can use the following sequence. Pass the absolute task worktree path and its branch name as arguments; the lock command supplies the `main` working directory. Add any checks required by the change before advancing `main`.

```sh
set -eu
task_worktree=$1
task_branch=$2
test "$(git -C "$task_worktree" branch --show-current)" = "$task_branch"
test -z "$(git -C "$task_worktree" status --porcelain)"
git -C "$task_worktree" merge --no-edit main
npm --prefix "$task_worktree" run check
npm --prefix "$task_worktree" run docs:check
test "$(git -C "$task_worktree" branch --show-current)" = "$task_branch"
test -z "$(git -C "$task_worktree" status --porcelain)"
test -z "$(git status --porcelain)"
git merge --ff-only "$task_branch"
```

Save the script outside tracked source and invoke `npm run integration:lock -- sh /absolute/integrate-task.sh /absolute/task-worktree codex/task-branch`. Resolve a failed merge in the task worktree, commit the resolution, then rerun the full locked sequence. Never overwrite dirty `main`, reset another chat's branch, stash its changes or weaken checks to integrate. If integration is unsafe or blocked, leave the reviewed task committed on its branch and report the concrete limitation to the user. Do not start a chat coordination loop to clear routine dirty-checkout or lock contention.

After a successful command launched from a `codex/` task worktree, `integration:lock` automatically deletes and unregisters that checkout, including local-only files and build outputs, while still holding the integration lock. Cleanup requires the task branch and commit to remain unchanged, its commit to equal local `main`, a clean checkout with no unfinished Git operation, and an unlocked registration without submodules. It targets only the invoking worktree and retains the task branch. A failed command never cleans up. A cleanup failure reports separately from the already completed integration.

The checkout first moves atomically to a temporary directory under `~/.codex/worktree-archives/<repository>/` so failed unregistration can restore it. After unregistration, the temporary directory is deleted immediately; successful integration retains no archived checkout or build output. The task branch remains available through `git worktree add <original-path> <branch>`; ignored and other local-only files are permanently deleted. Use `--keep-worktree` when those files are still needed. `CODEX_WORKTREE_ARCHIVE_ROOT` can select an external staging directory; a cross-filesystem move fails without deleting the source. Never stage inside the repository. If cleanup fails after integration, inspect the reported checkout or staging directory; `recovery.json` records the original path, branch and commit.

Use `npm run integration:lock -- --keep-worktree <command> [args...]` for intermediate integration when requested work, a preview or an experiment still needs the checkout. Otherwise cleanup is automatic; agents report its result before stopping. Commands launched from `main` do not remove any worktree.

Report integration status, local `main` checkout, task commit hash/subject, completed checks, unavailable coverage and worktree cleanup status, then stop. Worktree checks alone do not establish main integration or remote delivery.

## Concurrent commands

GPU checks and asset preparation share one local lane on loopback port 48158, separate from integration admission. Top-level operations acquire it; helpers do not borrow credentials or recursively acquire admission. Waiting reports contention and starts no work on cancellation/timeout. The OS releases the listener after process termination.

Let the lane and asset leases handle routine contention automatically. Do not negotiate verification windows through chat for normal waiting. Message only when a concrete resource problem requires another owner's action and repository evidence cannot resolve it; identify the resource and blocking condition.

Pure tests, static checks and builds do not acquire the GPU lane. Unit workers remain bounded at two and browser tests at one. Active asset leases independently protect cache data. Preserve foreground rendering quality; hidden/unfocused developer views throttle their own work and never advance background gameplay. Explicit automated rendering may retain continuous cadence.
