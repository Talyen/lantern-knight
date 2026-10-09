# Performance audit

Investigate confirmed startup, input latency, frame cost, retained memory, background work and delivery-weight problems while preserving presentation and gameplay. Apply the [shared audit contract](README.md); suspicious hot-path code is a lead until its cost is established.

## Investigation

- Choose representative scenarios, including repeated room entry/exit for retention and first-use versus sustained play for latency. Use [performance comparisons](../handoff.md#performance-comparisons) and [packaged player journeys](../handoff.md#packaged-player-journey-measurements) when they exercise the changed work.
- Locate the dominant cost and frequency across input, simulation, interpolation, room/actor presentation, lighting, renderer submission and storage. Avoid optimizing only the final draw when upstream event or allocation frequency is causal.
- Check GPU/resource leases, timers, listeners, caches and histories after teardown. A statically established unbounded retention problem may be confirmed without inventing a measured speedup.
- For payload/startup concerns, compare equivalent builds and asset identities. Distinguish acquisition, package startup, renderer readiness and gameplay; fewer bytes or submissions do not alone prove lower input latency or smoother pacing.

## Remedy and evidence

Follow [handoff evidence](../handoff.md) for comparable conditions, noisy measurements and rendering parity. Report phase-specific observations and uncertainty. Verify the change does not move cost to another phase or retain more memory.

Preserve visual fidelity, animation timing, particles, sound behavior and fixed-step outcomes. Renderer changes need actual output evidence appropriate to the changed calculation. Hidden/software observations do not certify visible reference-hardware performance.

Optimize repeated work and resource lifetime before proposing new execution architecture. Do not compensate by weakening checks, increasing CI workers or deleting intended spectacle. Tooling performance follows [execution budgets](../verification.md#e2e-coverage-and-execution-budgets); asset remedies follow [the authoring workflow](../assets.md). Captures remain requested diagnostics under existing policy.
