# Real-art integration and current placeholder pipeline

## Canon and deferred production

The male Lamplighter is the **exact original `image(3).png`**, Library `libfile_0da5071239448191b6962495ce1e0164`, Rust costume / Clean INK treatment. Design is locked, not an invitation for a new concept. Preserve the original bytes; no recoloring, recropping, refinement, regeneration or blending costume options. The standalone file is not available locally. The owner has deferred real art without a delivery date; PDF figure2 was inspected as a visual guide but was not extracted into a purported original PNG.

All current frames remain diagnostic or historical engineering art. The prior crimson/faceted rig is **not a canonical source or an acceptable Clean INK proof**. It is preserved for technical provenance only. Its old world-side equipment labels do not establish canonical anatomy. Production must match the pictured sword/right wrap and lantern/left bracer, including changing screen sides; never mirror asymmetric equipment to synthesize views.

No new runtime art was produced after the placeholder-only instruction. Existing PNGs are unchanged. Clips `attack_sword_02`/`03` explicitly reuse first-swing drawings with different visual holds; their three gameplay stages have distinct authoritative timing/range/damage. `enemy_*` clips preserve the wardens' separate placeholder frame references when hero clips are replaced.

## Stage boundaries

- `references/`: unchanged source handoff, owner update, canonical-file expectation. Concepts never import implicitly.
- `docs/design/`: original design PDF and current decision ledger; older decisions stay historical.
- `authoring/knight/`: historical engineering `.blend`, parametric script and old turnaround. Not a Rust/Clean INK master.
- `staging/`: original PNG frame inputs plus ordered `source.json`; reviewed real exports belong here.
- `public/generated/`: reproducible atlas pages, compiled v2 manifest, hashes, camera fixture and report. Never hand-edit generated truth.
- `evidence/`: actual lab/game/height/occlusion screenshots, test records and bounded performance result.

## Replace art without gameplay edits

1. Add the exact original `image(3).png` under `references/canon/` unchanged and record SHA-256. It is a design reference, not automatically a calibrated sprite or animation set.
2. Export reviewed **RGBA8 sRGB PNG** frames from one controlled canonical source. Use the selected v2 camera: exact35.264389682754654° elevation,45° azimuth, Y-up/XZ ground. Keep original canvas, density, foot registration and per-frame sockets explicit. Current diagnostic template is384×432,192 px/projected-world-unit, anchor(192,348); real source scale/density may change coherently after measured validation.
3. Add stable frame IDs, exact-case staged paths, origin/provenance/license and attachments to `staging/source.json`. Replace the selected clip's ordered `frames` and matching positive `durationsMs`. Hero clips are idle/walk, attacks01/02/03, dodge/hit/death/flare; enemy clips use `enemy_` prefixes. Do not alter gameplay code to change drawings. Preserve the shared provisional canvas/density for this first pack; independently sized character packs use separate v2 manifests in the typed asset catalog and actor visual bindings, rather than mismatched pixels in one canvas declaration. Hero production validation remains strict. The laboratory synthetic registration fixture is runtime QA metadata over unchanged pixels, not a canonical source or approved export.
4. Keep mixed/incomplete content diagnostic or proxy. Run:

```sh
npm run assets:validate
npm run assets:compile
npm run assets:check
npm run assets:inspect
npm run desktop
```

5. Inspect every supplied direction/clip in the actual lab: native/gameplay size, dark/light grounds, foot/trim/socket overlays, frame holds, timeline contact, silhouette, clipping, loop seam, equipment continuity. A valid manifest does not prove consistent artwork.
6. Only after the canonical source/style/motion proof and required content pass review: mark actual frame origins/asset production, set designReference to the exact Library ID, renderStyle `clean-ink`, register `canonicalReferenceHash`, remove historical `legacyBake`, and run `assets:production`. The compiler verifies the unchanged original reference bytes. Set `public/build-mode.json`'s `allowDevelopmentContent` false for a strict production-content build. Current content correctly fails that validation.

The first controlled production source must prove Clean INK fidelity, then articulated walk/attack01 in front/three-quarter, side and back coverage. One reusable 3D source/rig per character is the selected route; if a bounded style test fails, use a controlled layered 2D rig with authored views and overlap order. Do not force a visibly wrong 3D look. Art export is deferred, not falsely reported as complete. Image generation is for separately authorized concepts, not independent runtime animation frames or another hero reinterpretation.

## Existing executed engineering path

The old source/export route was exercised with Blender5.2.2 LTS before the owner update. It produced 16 d45 proxy drawings, a .blend, PNGs, contact/GIF evidence and a technical turnaround. These artifacts are historical, not approved Rust artwork. `tools/export.ts` is now guarded: ordinary `assets:export` refuses to promote that rig; explicit `--historical-proxy` is only diagnostic maintenance.

For the recorded v2 reconciliation, `tools/reconcile-placeholders.ts` retained those PNGs, recorded the old bake and revalidated the v1 rounding difference (about0.000000173 source pixels). Significant orientation changes fail. Span12→13 is framing, not a rebake angle. Current canonical camera/bake ID is `lantern-camera-v2`/2; original frame provenance remains visible. Stage02/03 and enemy aliases add metadata, not fabricated new animation drawings.

## Schema/compiler policy

Asset/source/runtime format v2 uses Zod-derived TypeScript types plus semantic checks. Metadata includes stable IDs/type/content version, bundle/provenance/status, canonical reference/style, camera/bake ID, original canvas/density/anchor/padding, sRGB/straight alpha/recipe, shadow/depth/collision reference, explicit clips/headings/frames/durations/notifies/fallbacks and resource dependencies. Runtime adds source mapping, per-frame trim/atlas rectangle, rotation=false, page dimensions/hash/file+RGBA bytes and required/optional bundle membership.

Validate real file format/alpha/depth/color, dimensions and nonempty pixels. Reject non-finite fields, invalid anchors/attachments/durations/rectangles, duplicate IDs/case-colliding paths, unknown/cyclic dependencies, missing required clips/headings/pages, incompatible camera and production placeholders. Action/death clips do not loop. A declared foot can lie outside opaque pixels. Source paths stay below staging, with exact segment-case and realpath confinement. Small valid/invalid fixtures and focused regressions cover failure publication and determinism.

Packing is deterministic from identical source bytes/tool versions: explicit order, fixed2048² PNG pages (max4096 and actual GPU capability check), no rotation. RGB dilates into transparent neighbors; edge extrusion2 and transparent gutter2 preserve filtering. Straight alpha stays consistent from decode through texture/material. Linear min/mag, no mipmaps; current 11–15 m headroom is tested. No KTX2 dependency or forced nearest filtering.

Pages finish in a temporary directory before content-addressed publication; `manifest.json` replaces atomically last. Failed builds leave the prior manifest intact. Old hashed folders are retained for in-flight consumers; cleanup is a deliberate release operation. Runtime leases/refcounts are bounded and deduplicate shared requests. PNG file compression is distinct from decoded/resident RGBA.

## Current art still missing

Exact standalone Rust reference file; canonical editable source and faithful Clean INK render proof; genuine representative multi-view motion proof; all required production views/three attacks/remaining clips; one real enemy and world kit. Existing tooling/runtime are ready to validate/import supplied frames. No camera-selection or hero-redesign gate is reopened. Hero scale/density and production consistency must still be measured.
