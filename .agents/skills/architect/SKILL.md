---
name: architect
description: Design new or structurally revised Lantern Knight contracts across runtime, content, presentation, desktop or asset-tool boundaries, including persisted schemas and resource lifetimes. Excludes private helpers and ordinary use of existing contracts.
---

# Public-contract design

Read the relevant owner and [foundation change recipe](../../../docs/foundation.md#change-recipes), then inspect the existing contract and its consumers before choosing a shape.

- Reuse the current owner when it can express the requirement. Introduce a boundary only for a concrete consumer or invariant; avoid speculative options and duplicate representations.
- Model valid states and operations in TypeScript before wiring consumers. Trace reads, writes, failure, re-entry and disposal; make mutation and resource ownership explicit.
- For persisted changes, follow [saved-state changes](../../../docs/foundation.md#change-saved-state). For simulation or presentation changes, follow [action timing](../../../docs/foundation.md#change-action-timing-or-presentation) and [import boundaries](../../../docs/foundation.md#import-boundaries). For asset contracts, follow [the asset workflow](../../../docs/assets.md); distinguish runtime consumption from authoring and publication.
- Update the owner, affected consumers and canonical documentation together. Select protection for the changed invariant under [test value](../../../docs/verification.md#test-value); use the existing [verification workflow](../../../CONTRIBUTING.md#verification).

For concurrent tasks crossing owners, agree shared interfaces under [task ownership](../../../docs/task-coordination.md#parallel-task-ownership) before independent edits. Ordinary changes within an existing contract follow those owners directly.
