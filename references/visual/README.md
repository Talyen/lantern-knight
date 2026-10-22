# Visual references

Inspect images before designing. References describe relationships to preserve, not an instruction to copy every detail. [Frontend design](../../.agents/skills/frontend-design/SKILL.md), [scene design](../../.agents/skills/lantern-scene-design/SKILL.md) and [product copy](../../docs/product-copy.md) own the workflows.

## Inspect the set

The durable local gallery is outside Git and disposable worktrees:

`/Users/ryanmcintire/.codex/visualizations/2026/10/22/lantern-reference-study-final/review.html`

Its adjacent `review-provenance.json` records image hashes, origins, scope and approval status. Open the gallery in a browser, or inspect the individual files with an image viewer. If unavailable on another machine, regenerate the studies with `npm run ui:study -- --output /absolute/new/reference-study`, capture the listed concept screens, and reproduce Game views with `LANTERN_OPENING_CAPTURE_DIRECTORY=/absolute/captures npm run test:browser -- game-inventory`. This recreates examples, not historical votes or identical scene frames. Never substitute a new screenshot under an old human preference.

| Image in gallery directory | Status and useful relationship | Limit |
| --- | --- | --- |
| `canonical-hero.png` | Canonical owner-supplied artwork: clear silhouette, broad connected dark shapes, warm focal lantern and restrained material detail. | Character/style authority; not a new UI layout or animation approval. Exact source: [canonical reference](../canon/README.md). |
| `workbench-study.png` | User-selected centered workbench structure, as recorded in [UI polish](../../docs/ui-polish.md#production-follow-through): equipment left, pack right, reserved details below. | Approval applies to the layout choice, not every label, frame or surface treatment. |
| `title-study.png` | Agent-curated title example: one action group, distinct primary action and substantial quiet scenery. | Concept, not production Game or human-approved final title art. |
| `settings-study.png` | Agent-curated settings example: categories separated from aligned control rows; advanced controls disclosed. | Concept with temporary state; no persistence or accessibility certification. |
| `hud-study.png` | Counterexample: persistent location/look labels and control strip compete with the world. | Agent critique grounded in [quiet gameplay UI](../../docs/game-design.md#opening-guidance); no new human rejection claimed. |
| `art/forge.png` | Supplied environment illustration: inspect intact architectural masses, connected shadow planes and path spacing. | Source-art reference; it does not prove gameplay scale, traversal, prop placement or human approval of a new composition. |
| `inventory-before.png`, `comparison-before.png` | Human-preferred incumbent: the user chose B (this framed version) over the unboxed alternative. | One complete-image preference; individual reasons remain unknown. The conditional detail layout still shrinks the kit. |
| `inventory-after.png`, `comparison-after.png`, `inventory-narrow.png`, `comparison-narrow.png` | Revised framed candidate: preserves the preferred shell and equipment treatment, with a stable comparison area. | Round 2 preferred `comparison-after.png`; other views remain agent-reviewed supporting evidence. |

The gallery also includes `inventory-focus.png`, `inventory-disabled.png` and `inventory-error.png`: actual keyboard focus, disabled Equip and full-pack recovery states. These demonstrate interaction presentation, not human preference.

## Independent visual anchor

`darkest-dungeon-reference.png` is a browser capture of [Red Hook's official Steam screenshot](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/262060/ss_04572edc979601b038756f87861c6f8c6c337806.1920x1080.jpg?t=1789168187), published on the [developer's storefront](https://store.steampowered.com/app/262060/Darkest_Dungeon/). Agent-curated, not user-approved Lantern direction. Inspect the connected black shapes, darker scenery behind actor silhouettes and concentrated red/gold accents. These are visual observations, not measured usability claims. Do not borrow its HUD density, proprietary lettering or assets; Lantern's canonical artwork remains the style authority. This external comparison prevents the reference set from consisting entirely of prior agent output.

## Recorded comparison

Round 1: A was the unboxed candidate and B the original framed workbench. The user selected **B**. Exact images and hashes are recorded in `preference-01.json` beside the gallery. The losing treatment is retained as `inventory-rejected.png` and `comparison-rejected.png`, explicitly marked rejected. Do not infer that every individual change in the losing image was disliked. The next candidate retains the incumbent's visual treatment and addresses the demonstrated selection-driven layout shift.

In round 2, A was the original framed comparison and B the revised framed comparison. The user selected **B**, preferring `comparison-after.png` over `comparison-before.png`. Exact hashes are in `preference-02.json`. Preserve the revised comparison as a scoped positive reference; the reasons and transfer to other screens remain untested. The UI contents and viewport matched, but the original capture used software WebGL and the revised capture used hardware-configured rendering.

## Use and maintain

Choose the relevant images and inspect them at their intended scale. A menu concept does not establish encounter readability; artwork style does not establish interface usability. Compare references to actual output, including constrained layouts and interaction states. Match contents, viewport, scale, focus and scene settings when comparing variants; disclose rendering differences.

Human preferences establish a winning image only. Agent explanations remain hypotheses. Start comparisons with meaningfully different directions; refine a preferred direction with controlled changes, and test inferred rules on another screen or scene. Honor unsolicited rejection of both without inventing a winner. Keep raw captures and votes outside Git; retain only transferable decisions and their exact evidence here. Do not promote candidate work simply because an agent implemented or merged it.
