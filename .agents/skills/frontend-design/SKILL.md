---
name: frontend-design
description: Design or refine Lantern Knight menus, HUD, and developer interfaces with deliberate typography, hierarchy, motion, and copy. Use for UI design work; artwork generation and production scene composition use their specialized skills.
license: Complete terms in LICENSE.txt
---

# Frontend design

Adapted from [Anthropic's frontend-design skill](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md), revision `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`, under the [Apache 2.0 license](LICENSE.txt).

Local modifications: narrowed applicability to Lantern Knight UI, condensed the upstream principles, made planning proportional to the change, and connected existing components, art direction, scene guidance, and verification. Upstream updates are reviewed manually.

## Ground the design in the game and the brief

Read the relevant screen and its existing components, styles, fonts, and interaction patterns before designing. Identify the audience and the screen's primary job from the request and project context. Ask only when missing information materially affects the design.

Reuse established visual conventions by default. Make choices specific to Lantern Knight and the task rather than importing a generic dashboard or landing-page treatment. The user's brief takes precedence over aesthetic advice, including when it deliberately asks for a familiar treatment or a prototype experiment.

Preserve Clean INK art direction. For artwork or texture generation, editing, replacement, or art direction, apply `lantern-art-direction` at the location specified in [AGENTS.md](../../../AGENTS.md). For production scene composition, use [lantern-scene-design](../lantern-scene-design/SKILL.md). This skill guides interfaces; it does not replace those workflows.

## Design principles

- Use typography to express hierarchy and character through intentional size, weight, spacing, and line length. Reuse the project's fonts unless a change is requested or justified by the brief. Keep body text readable; avoid decorative labels and arbitrary emphasis that add no information.
- Let layout explain relationships and priorities. Borders, grouping, numbering, and labels should communicate something useful. Number content only when it represents a sequence. Avoid turning every element into an identical card.
- Choose color and contrast for the screen's purpose and established palette. Gradients, accent colors, all-caps labels, and familiar visual styles are options, not compulsory defaults or prohibited treatments.
- Spend visual boldness where it serves the main task, and keep supporting elements disciplined. Remove decoration that distracts from play or authoring.
- Use ambient motion sparingly and deliberately. Motion responding to opening, selection, or confirmation should clarify what changed. Respect reduced motion and preserve relevant gameplay feedback.
- Maintain visible keyboard focus, accessible names, readable contrast, and usable layouts at the project's supported viewport sizes. Preserve existing input flows and interaction semantics.
- Write from the player's or tool user's perspective. Use plain verbs and consistent action names: a button saying "Save changes" should produce matching confirmation. Explain failures with a useful recovery action and give empty states a clear next step.

## Match the process to the change

For a new screen or substantial redesign, first write a brief plan covering the primary task, palette, type roles, layout, and the distinguishing idea. Reuse existing tokens where possible; a short wireframe can help compare layouts. Review the plan against the brief and revise choices that feel unrelated to the game before implementing. No separate approval gate is required by this skill.

For a small spacing, label, color, or alignment fix, inspect the surrounding conventions and make the focused edit directly. Do not require a new palette, wireframe, or redesign exercise.

Critique hierarchy, legibility, copy, and interaction states as the work develops. Check CSS specificity and layout interactions when changing shared styles. For explicit visual investigations, capture and inspect the actual output, preserving captures outside Git. Screenshot review can also help assess substantial visual changes; structural checks alone do not establish visual acceptance.

Follow [development](../../../docs/development.md) and [verification](../../../docs/verification.md): finish ordinary work with fresh `npm run check`, and run the relevant `npm run test:browser -- [scenario]` when browser interactions change. Report the checks actually completed and any remaining visual or delivery coverage.
