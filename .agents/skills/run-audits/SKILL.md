---
name: run-audits
description: Run requested Lantern Knight audits using docs/audits. Use for a named audit or all audits; does not activate for ordinary implementation or unrelated cleanup.
---

# Run Lantern Knight audits

Read [the audit routing and scope contract](../../../docs/audits/README.md), then the requested guides before investigating. Each guide supplies a distinct lens; [Contributing](../../../CONTRIBUTING.md#review-and-investigation) owns the shared evidence requirements.

- Resolve the requested scope through the routing table. “All audits” means the four linked guides, excluding the README. Do not execute an uncited sibling sweep or turn findings into standing cleanup. Zero confirmed findings is a valid result.
- Inspect current changes and preserve other owners' work. Trace candidates through actual consumers and check counterevidence before confirming them. Keep connected causes and fixes under one primary finding, even when they cross lenses.
- Fix confirmed causes within the user's authorization. Use [architect](../architect/SKILL.md) when the remedy changes a shared contract, and existing [task ownership](../../../docs/task-coordination.md#parallel-task-ownership) when coordinating concurrent work. Audit execution alone does not request delegation.
- Review the final diff against the evidence and [test value](../../../docs/verification.md#test-value) policies. Verify changed behavior using [the regular and affected scene/delivery checks](../../../CONTRIBUTING.md#verification).

Report findings fixed, unresolved confirmed issues, zero-finding scopes, inspected versus sampled areas and checks actually completed. Keep results in the chat handoff; update enduring rationale in its canonical owner rather than adding completed records to the guides.
