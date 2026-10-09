# Local skill routing

Use a skill when its workflow applies. [AGENTS.md](../../AGENTS.md) owns artwork and repository boundaries. [Contributing](../../CONTRIBUTING.md) introduces review and integration; [verification](../../docs/verification.md) and [task coordination](../../docs/task-coordination.md) own the detailed workflows.

| When                                                                                                          | Skill                                                 |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Add or structurally revise a contract across runtime, content, presentation, desktop or asset-tool boundaries | [architect](architect/SKILL.md)                       |
| Run a requested named audit or all audits                                                                     | [run-audits](run-audits/SKILL.md)                     |
| Compose or inspect production scenes using curated flat-stage artwork                                         | [lantern-scene-design](lantern-scene-design/SKILL.md) |
| Design or refine menus, HUD, and developer interfaces                                                        | [frontend-design](frontend-design/SKILL.md)           |

`architect` designs a changed contract; `run-audits` investigates evidence against current contracts. Ordinary use of an existing contract or a private helper does not need a separate design workflow. Creating or editing audit guidance does not request execution of the audits.

Verification and E2E authoring use the existing [verification](../../CONTRIBUTING.md#verification) and [test value](../../docs/verification.md#test-value) policies. Artwork generation and editing use the art-direction skill identified in AGENTS.md.
