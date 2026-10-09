# Contributing

Follow [Development](docs/development.md) for the edit–play–check loop. Prefer clear local changes and deletion of superseded machinery. Preserve unrelated edits and original artwork.

## Verification

Finish with fresh `npm run check`. Slow/integration checks and affected browser scenarios run in CI by default; targeted local diagnosis or validation remains available. [Verification](docs/verification.md) owns test selection, asset/native checks and evidence requirements. Local checks do not establish hosted CI or visible playtesting.

## Review and investigation

Inspect the complete relevant diff, including new files, and surrounding consumers. Confirm a reachable defect or contract problem, check counterevidence, and fix the connected cause. Add or retain only high-value coverage, allowing zero new tests when appropriate, under [test value](docs/verification.md#test-value). Keep docs consistent with behavior and link to the owning guide rather than copying its rules.

## Collaboration and commits

[Task coordination](docs/task-coordination.md) owns worktrees, shared interfaces, local integration and standing task-commit authorization. Pushes and publication require the user's request. Report the change, integration/commit, completed checks and unavailable coverage.
