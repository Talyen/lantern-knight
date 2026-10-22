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

Inspect the [visual references](../../../references/visual/README.md) and the [product-copy policy](../../../docs/product-copy.md) before substantial work. Existing implementation is evidence, not automatic aesthetic authority. For inventory, preserve the user-selected workbench structure unless the brief changes that direction; distinguish approved references from agent candidates and rejected examples. Reuse established visual conventions when they meet the brief. Make choices specific to Lantern Knight and the task rather than importing a generic dashboard or landing-page treatment. The user's brief takes precedence over aesthetic advice, including when it deliberately asks for a familiar treatment or a prototype experiment.

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

For a new screen or substantial redesign:

1. Inspect the current rendered screen and the relevant reference images. State the primary task and the concrete relationships to preserve (for example, equipment beside the pack and an unmoving inspection area). A prose mood description is not a visual target.
2. Establish the focal point, proportions, grouping and quiet space before type, materials, ornaments or motion. Compare meaningfully different arrangements when the direction is unresolved; do not ask the user to choose between tiny offsets in an unsuccessful design.
3. Implement using shared tokens and components where they fit. Apply the product-copy policy to every new visible sentence. Keep necessary labels, consequences, accessible names and recovery information.
4. Capture and inspect the actual implementation at ordinary usage scale. Include desktop and a constrained viewport, plus relevant selection, keyboard focus, disabled, empty and error states. Inspect motion in motion when transitions or animation change. Keep captures outside Git and disposable worktrees.
5. Name the three most consequential visible defects, correct them and inspect a fresh capture. Replace a failed arrangement instead of adding ornament. Record concrete remaining defects and coverage limits; a self-rating or passing test does not establish visual acceptance.

Small spacing, label or alignment fixes need focused rendered inspection, not a new direction exercise. If rendering is unavailable, mark the change visually unverified; do not promote it into the reference set as accepted.

Use occasional A/B comparisons to calibrate unresolved taste, not as a permission gate for every edit. Show matching views with equivalent contents and settings; ask only which image is preferred. Honor unsolicited rejection of both. Record the selected image and keep explanations inferred by agents as hypotheses. When a candidate loses, retain the preferred incumbent and retire the losing treatment; revise the candidate before claiming improvement. Rendered evidence alone does not demonstrate a better result. A preference for one screen does not approve unrelated UI or establish a general rule. Consolidate confirmed patterns in shared components rather than redesigning them independently.

Follow [development](../../../docs/development.md) and [verification](../../../docs/verification.md): finish ordinary work with fresh `npm run check`, and ensure appropriate CI scenarios cover changed browser interactions. Slow local execution is for targeted diagnosis or validation under the canonical test policy. Report the checks actually completed and any remaining visual or delivery coverage.
