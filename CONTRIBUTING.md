# Contributing

Follow [development](docs/development.md) for the edit–play–check loop. This repository is a prototype; prefer clear local changes and deletion of superseded machinery. Preserve unrelated edits and original artwork.

## Verification

Use focused pure tests while editing, then `npm run check` after changes stabilize. Changed browser interactions receive their relevant `npm run test:browser -- [scenario]` coverage. Asset-backed, native and milestone checks are separate under [verification](docs/verification.md). Run source-free asset validation when asset consumption changes; original preparation/publication remains explicit.

## Review and investigation

Inspect the complete relevant diff and surrounding consumers. Confirm a reachable defect or contract problem, check counterevidence, and fix the connected cause. Report actual scope, limitations and tests executed. Local checks are not hosted CI or visible playtesting. Add consequential coverage instead of tests mirroring implementation details.

## Collaboration and commits

Use worktrees for independent/concurrent changes and agree ownership of shared interfaces. Small sequential work needs no task registration. [Task coordination](docs/task-coordination.md#handoff-and-commits) owns local integration and standing task-commit authorization. Pushes and publication require the user's request.

Rules have one owner: [development](docs/development.md), [architecture](docs/architecture.md), [assets](docs/assets.md), or [verification](docs/verification.md). Feature guides link to them. Keep docs and process entry points consistent with code.
