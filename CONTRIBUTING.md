# Contributing

Follow [Development](docs/development.md) for the edit–play–check loop. Prefer clear local changes and deletion of superseded machinery. Preserve unrelated edits and original artwork.

## Verification

Follow [Verification](docs/verification.md#regular-checks) for change-aware checks and [additional coverage](docs/verification.md#test-selection). Local checks establish only the coverage actually run.

## Review and investigation

Inspect the complete relevant diff, including new files, and surrounding consumers. Confirm a reachable defect or contract problem, check counterevidence, and fix the connected cause. Add or retain only high-value coverage, allowing zero new tests when appropriate, under [test value](docs/verification.md#test-value). Keep docs consistent with behavior and link to the owning guide rather than copying its rules.

## Collaboration and commits

[Task coordination](docs/task-coordination.md) owns isolation, authorization, the integration command and completion reporting.
