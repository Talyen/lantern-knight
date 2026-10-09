# Audits

These guides support requested one-shot investigations. They do not create a standing backlog or authorize unrelated product changes. Creating or editing a guide does not request its execution.

## Routing and scope

| Requested concern                                                              | Guide                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------- |
| Runtime defects, asynchronous lifetime, transitions and current checkpoint behavior    | [Runtime correctness](runtime-correctness.md) |
| Dead code, duplicate paths, misplaced ownership and maintenance cost           | [Simplification](simplification.md)           |
| Startup, interaction latency, frame cost, memory and delivery weight           | [Performance](performance.md)                 |
| Consequential coverage, false confidence, redundancy, flake and execution cost | [Test quality](test-quality.md)               |

Run the guide matching the user's request; “all audits” means these four guides. A full requested audit inspects each scope area and representative important flows, including unchanged code. Repeat passes can start with changed or previously uncertain areas when a reliable baseline exists. Report inspected, sampled and unavailable scope without presenting sampling as exhaustive proof.

[Review and investigation](../../CONTRIBUTING.md#review-and-investigation) owns confirmation, counterevidence, prioritization and causal remedies. Keep one primary finding per connected cause. Follow that cause across relevant consumers without launching an uncited sibling sweep. Audit heuristics are discovery aids, not new correctness gates or findings quotas; an explicit user-requested count still governs the task.

## Owners and verification

Use [foundation](../architecture.md) for runtime ownership and compatibility, [scene design](../scene-design.md) for production construction, [assets](../assets.md) for preparation and publication, and [handoff](../handoff.md) for performance and delivery evidence. [AGENTS.md](../../AGENTS.md) retains artwork and repository boundaries. Discovery uses authored sources and bounded asset inspection, following those rules.

[Verification](../../CONTRIBUTING.md#verification), [test value](../verification.md#test-value) and [concurrent commands](../task-coordination.md#concurrent-commands) retain their fresh checks and ownership. Use the cheapest meaningful protection for the original problem and report completed versus unavailable checks. A passing static gate does not settle a semantic ownership question or establish visual acceptance.

Keep enduring rationale in the owning document and run results in the chat handoff. Do not append completed audit ledgers or historical diagnostics here. Precise, low-noise invariants may belong in an existing lint, type, test or documentation gate rather than additional audit prose.
