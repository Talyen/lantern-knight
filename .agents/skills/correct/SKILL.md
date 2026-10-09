---
name: correct
description: Prevent demonstrated recurring agent mistakes through ownership, types, existing lint, or behavioral tests. Use for recurrence-prevention requests or an established recurring problem within the task; isolated corrections do not trigger broad hardening.
license: Complete terms in LICENSE.txt
---

# Correct

Adapted from [pstack's correct skill](https://github.com/backnotprop/pstack/blob/3a604672c46cd8187d2b19980eae0a34f9f91138/skills/correct/SKILL.md), revision `3a604672c46cd8187d2b19980eae0a34f9f91138`, under the [MIT license](LICENSE.txt). This local adaptation requires demonstrated recurrence, keeps remedies scoped, and removes mandatory rule tables and per-class commits. Upstream updates are reviewed manually.

Use when the user asks to prevent a repeated mistake, or the current authorized task contains an established recurring problem. A single correction gets its immediate scoped fix without launching repository-wide hardening.

Find concrete evidence of at least two occurrences of the same mistake class in relevant code, commits, reverts, review findings, or available conversation context. Distinguish recurrence from several symptoms of one defect. If recurrence is unproven, say so and address only the authorized immediate issue.

Choose the smallest prevention that removes the demonstrated failure:

1. Prefer existing ownership and architecture: one source of truth, one state owner, or removal of a superseded path. Use [architect](../architect/SKILL.md) for structural shared-contract changes.
2. Use types to prevent the invalid state or operation. If it still compiles, consider the existing lint or boundary checks, with a diagnostic that points to the supported approach.
3. Protect consequential behavior at the cheapest sufficient test layer under [test value](../../../docs/verification.md#test-value).
4. Use documentation for judgment that cannot reasonably be enforced. Update its canonical owner rather than accumulating repeated rules in agent instructions.

Do not redesign unrelated systems or add a new CI gate merely because a broader prevention is possible. If a sufficient remedy exceeds the task's authorization, report the concrete dependency and proposed follow-up; do not silently expand scope.

Prove the prevention rejects a demonstrated bad case and accepts the supported behavior. Use an isolated fixture or reversible local reproduction; do not damage shared state or weaken existing checks. Report the recurrence evidence, chosen prevention, why a more structural fix is unnecessary or outside scope, and the actual proof.

Follow [development](../../../docs/development.md), [verification](../../../docs/verification.md), and [task coordination](../../../docs/task-coordination.md) for implementation and delivery. No decision log or rule-enforcement table is required.
