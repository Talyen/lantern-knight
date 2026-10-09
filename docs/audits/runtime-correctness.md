# Runtime correctness audit

Find reachable crashes, wrong combat outcomes, blocked input or progress, checkpoint loss and stale work that corrupts a newer lifecycle. Apply the [shared audit contract](README.md); async syntax or a missing guard alone does not establish a defect.

## Investigation

- Trace player input through accepted operations, fixed-step simulation, session mutation, persistence, feedback and re-entry. Include rapid repetition, pause, area transitions, death/retry, loading failure and disposal where relevant.
- Inspect `Application` acquisition/startup and teardown, foreground/pause requests, generation-scoped events, and room/actor resource leases against [runtime ownership](../architecture.md). Distinguish work allowed to complete safely from stale work that can revive or mutate a disposed application.
- Follow checkpoints through parsing, capture/restore, current schema validation, captured writes, browser storage and atomic Electron writes under [saved-state changes](../architecture.md#change-saved-state). Compare uninterrupted progress with save/load and failed-operation recovery. Use isolated fixtures and profiles.
- Trace renderer/desktop inputs through the existing Bridge, preload and storage owners. Check malformed inputs and session mismatches against the current contract; do not replace validated operations with ad hoc writes.

## Remedy and evidence

Identify the reachable bad state and the responsible validation, transaction or lifetime owner. Fix the cause across affected consumers; do not add universal cancellation or duplicate pending flags where existing ownership already makes completion safe.

Preserve fixed-step gameplay authority, checkpoint byte protection and profile isolation through the foundation contracts. Resolve ambiguous gameplay or recovery intent through [design intent](../game-design.md) and current owners rather than inventing a fallback.

Exercise the repaired boundary with protection capable of exposing the original defect, including interruption, failure or re-entry when causal. Scene traversal does not establish real input, combat or checkpoint behavior; select the appropriate pure or packaged coverage under [verification](../../CONTRIBUTING.md#verification).
