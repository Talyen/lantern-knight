---
name: lantern-scene-design
description: Place props and enemies coherently in Lantern Knight production scenes, inspect rendered compositions, or improve placement guidance through screenshot preferences. Excludes unrelated UI and Effects laboratory experiments.
---

# Lantern scene design

Read [scene design](../../../docs/scene-design.md), the relevant [scene brief](../../../authoring/scenes/README.md), and the project's artwork instructions. Existing source paintings establish the landmarks, paths and perspective. Technical acceptance does not establish good composition.

## Compose from the painting

Inspect a clean overview and gameplay-camera views with the hero visible before editing. Identify the route, working areas, focal landmark, approach to each encounter and retreat space. Separate scenery already painted into the floor from independent objects. Do not infer an empty placement area from coordinates or collision masks alone.

For each group, decide who used it, what they were doing and why it belongs beside that particular landmark. Put supplies where someone could reach and use them. Compose a primary object and related supporting objects with useful gaps; inspect repeated silhouettes, accidental tangencies and whether the group competes with the painting. Leave quiet ground between meaningful groups. These are starting hypotheses, not a mandatory object count or universal clustering recipe.

Calibrate size beside the hero and painted human-scale landmarks. Inspect full drawings, opened/broken states and all relevant enemy facings. Read painted paths visually and keep complete object silhouettes off them. Check footing, occlusion and grounding in the renderer. Avoid enlarging a prop merely to make it noticeable.

The painting-envelope checks do not prevent a guard or another prop from hiding a container. Review overlaps between independent objects in the actual approach view, including enemy poses and opened lids; every gameplay target needs a readable silhouette and an accessible front.

Place enemies as encounter beats: what the player sees first, where engagement begins, which enemies join, where the player can fight and how they can retreat. Inspect the approach at gameplay scale with actual lighting. Do not use evenly spaced decoration, a pretty overview or valid spawn clearance as proof of a good encounter. Check movement and combat separately from screenshot preference.

Establish a coherent overall arrangement before refining individual offsets. If both alternatives are rejected, develop distinct compositions rather than continuing to nudge the same few objects. Once an arrangement is preferred, test one meaningful refinement at a time in the same views. Remove purposeless objects and revise crowded groups. Preserve the painting and unrelated gameplay. Use the [verification workflow](../../../CONTRIBUTING.md#verification); report actual structural, browser, native and visual coverage.

## Learn from screenshot preferences

For a placement learning session, follow [the comparison loop](references/comparison-loop.md). The human's only requested input is **which of two screenshots they prefer: A or B**. Agents own briefs, alternatives, technical checks, capture, records, interpretation and skill revisions. Never request explanations, scores, annotations, editor work, approval of prose, or a third choice.

Honor an unsolicited rejection of both images. Record no winner, retain both failures, and broaden the next comparison. Do not turn “equally bad” into a tie that advances either layout or invent the user's reasons.

Read [placement lessons](references/placement-lessons.md) before proposing a learned rule. Human preferences establish which image won. Reasons inferred by an agent remain hypotheses until tested with a controlled change and a fresh scene. Do not present this initial guidance as empirically calibrated taste.
