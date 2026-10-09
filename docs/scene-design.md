# Scene design

Production scenes use flat ground and intact illustrated scenery. Painted 3D environment construction is superseded by this policy. The [scene registry](../src/content/scene-design.ts) owns eligible artwork, real dimensions, footprints, scale limits and named sockets; scene placements cannot redefine them. Missing suitable artwork requires artwork authoring under the canonical [Clean INK prompt](../references/canon/clean-ink-style.prompt.txt).

## Construction and composition

- Keep playable stages flat. Rendering planes, invisible collision and shadow proxies remain supported; hills, steps, raised terraces and visible textured blocks do not.
- Use cohesive whole building shells or open-front interior shells. Attach only compatible artwork at registered sockets. Structural clipping and prose overlap waivers are prohibited; natural depth occlusion is permitted.
- Preserve artwork silhouettes and projection. Do not crop, cut, stretch, deform, repaint or manipulate UVs to manufacture scenery. Transparent-margin trimming and atlas sampling preserve registration and visible pixels.
- Use semantic world sizes. Independent props normally allow 0.85–1.15 of their registered size. Shells, ground panels and attachments use registered dimensions. A tree is never substituted for a bush by shrinking it.
- Select a scene palette and assign every object to a focal, supporting or framing zone. Clear traversal/combat zones remain available; random filler placement is prohibited.
- Ground supports scenery through quiet colors and broad smooth fills. Paths, threshold transitions and paving are authored images, never runtime painting or shader masks.

## Native ground panels

Measure actual source dimensions. A roughly 1k image covers about four metres at 256 native pixels per metre, not an entire room. Use a quiet repeatable bed and coordinated intact path/floor/threshold panels with authored joins; register their physical coverage and density. Do not enlarge rasters or relabel enlarged outputs as native. Review joins, repeated landmarks and material contrast in the production renderer. The ground is one designed composition assembled from registered panels, rather than arbitrary overlapping ground decals.

## Verification

Use the [contributing handoff](../CONTRIBUTING.md#verification): deterministic checks, scene acceptance and direct visual inspection of requested captures. Runtime artwork changes finish through the existing [asset finalization workflow](assets.md#local-preparation-review). Captures and temporary diagnostics remain outside Git.
