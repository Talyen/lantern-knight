---
name: unslop
description: Tighten repository prose, PR descriptions, and substantial task reports by removing filler, vague claims, and repetitive framing. Preserve technical meaning and intentional game-writing voice.
license: Complete terms in LICENSE.txt
---

# Unslop

Adapted from [pstack's unslop skill](https://github.com/backnotprop/pstack/blob/3a604672c46cd8187d2b19980eae0a34f9f91138/skills/unslop/SKILL.md), revision `3a604672c46cd8187d2b19980eae0a34f9f91138`, under the [MIT license](LICENSE.txt). This local adaptation uses contextual selection and flexible style guidance. Upstream updates are reviewed manually.

Apply while writing or editing technical prose; do not require a separate user command or visible editing report.

- State the concrete action, mechanism, result, or decision. Replace vague improvement claims with supporting facts; do not invent measurements or sources.
- Remove filler, chatbot phrases, flattery, stock conclusions, forced contrasts, and repetitive introductions. Keep useful context and supported uncertainty.
- Prefer plain verbs, active voice, and consistent names. Keep precise technical terms when replacing them would lose meaning.
- Split sentences that require rereading. Preserve complete sentences and useful explanations rather than compressing prose into fragments or symbol shorthand.
- Use lists, headings, and emphasis when they help the reader. Do not force a particular number of points or restate a label in its explanation.
- Choose punctuation for clarity. Dashes, parentheses, colons, and typographic quotes are not automatically errors.

Preserve facts, citations, code, identifiers, exact quotations, and the author's intended tone. Do not flatten deliberate dialogue, lore, humor, or player-facing character voice into technical prose. Follow the user's requested format and the repository's established documentation structure.

Before finishing, check that editing has not changed the claim or overstated the evidence. [Verification](../../../docs/verification.md) defines what completed checks establish.
