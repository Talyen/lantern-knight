---
name: blast-radius
description: Review what a change could break downstream and prove consequential safety assumptions across behavior owners. Use for downstream-impact reviews or cross-owner safety questions, not trivial edits within an existing contract.
license: Complete terms in LICENSE.txt
---

# Blast radius

Adapted from [pstack's blast-radius skill](https://github.com/backnotprop/pstack/blob/3a604672c46cd8187d2b19980eae0a34f9f91138/skills/blast-radius/SKILL.md), revision `3a604672c46cd8187d2b19980eae0a34f9f91138`, under the [MIT license](LICENSE.txt). This local adaptation removes companion-skill and model-panel dependencies and uses existing verification. Upstream updates are reviewed manually.

Read the requested change and its relevant owners and consumers. Keep investigation proportional to the actual downstream consequences; ordinary private-helper edits do not need a separate impact exercise.

Identify the assumptions the change's safety depends on. Follow consequences a symbol search alone misses: persisted or serialized values, runtime/content/presentation/asset boundaries, event ordering, resource ownership, failure, cancellation, re-entry, and disposal. Inspect relevant dependency code only when needed, respecting the repository boundaries in [AGENTS.md](../../../AGENTS.md).

For consequential assumptions, use the cheapest sufficient executable proof under [verification](../../../docs/verification.md). Prefer an existing behavioral test or a small real-code reproduction. Use browser or native evidence when the risk depends on those integrations. Source inspection helps explain the claim but does not establish runtime proof. Mark assumptions unproven when execution is unavailable, and identify the remaining check.

Report what changed, confirmed risks with code evidence, the safety assumptions and their proof, and material risks checked and cleared. Avoid speculative lists without a reachable failure or concrete dependency. A review request alone does not authorize fixing unrelated issues or launching the full audit catalog.

If an authorized remedy structurally changes a shared contract, apply [architect](../architect/SKILL.md). Requested named audits remain with [run-audits](../run-audits/SKILL.md). Follow [development](../../../docs/development.md) and [task coordination](../../../docs/task-coordination.md) for edits and integration.
