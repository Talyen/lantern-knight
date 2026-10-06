# Controlled authoring and asset replacement

## Stage boundaries and ownership

1. `references/`: unchanged handoff documents and pasted assignment. Concepts and illustrative JSON never enter the importer implicitly.
2. `authoring/knight/`: editable `rig.blend`, original `export.py` parametric mesh/rig/pose source, turnaround stills. Blender 5.2.2 LTS, constant-limb recipe v2; project-original proxy, no external asset license dependency.
3. `staging/`: lossless PNGs, `proxy/export.json`, explicit ordered `source.json`. Diagnostic authoring lives in `tools/diagnostic.ts`; it labels every synthetic view. Keep original canvases; never trim by hand.
4. `public/generated/`: compiler-owned content-addressed PNG atlas pages, manifest, SHA-256, calibration fixture and report. Never edit these to repair source truth.
5. `evidence/`: native-size/game-size contact sheets, timing-respecting looping previews, packaged UI screenshots, smoke and performance reports.

The Blender route gives actual front/side/back views and consistent asymmetric equipment with one original rigid-part model. It is less expressive than a finished illustration rig, but is controlled and repeatable. The proxy has a cropped-haired male head, narrow coat, modest shoulder piece, sword in anatomical +X/right, lantern in −X/left. This is a technical lighter-armored proxy, not an approved character design.

The canonical axis conversion is game (X,Y,Z) = Blender (X,Z,−Y). Positive Blender Z rotation maps the game's positive yaw. The character root remains at ground (0,0,0); d45 rotates it +45°. Source camera uses the same contract and projection basis, with a target shifted along screen-up so ground projects to untrimmed (192,348). Export is 384×432 RGBA8, transparent film, Standard view, zero exposure, gamma 1, fixed key/fill lights and flat restrained materials.

## One working example

```sh
npm run assets:diagnostic  # all required diagnostic views/clips; resets source.json deliberately
npm run assets:export      # build/editable proxy, PNGs + metadata; merge d45 walk/attack
npm run assets:compile     # validate -> trim -> dilate/extrude -> deterministic atlases
npm run assets:inspect     # contact sheets and GIFs
npm run desktop
```

Select **Animation lab → walk → d45**. The frame status reads `BLENDER-PROXY`. Then select `attack_sword_01`. The encounter's travel in d45 uses the same walk frames, and a d45 sword action uses the same attack frames. Idle d45 reuses the first walk drawing; it is explicitly not a produced idle loop. Other headings and dodge/ability/hit/death are labeled diagnostics. The `run` ID has an explicit walk fallback; no directions or asymmetric equipment are mirrored.

Original frame sequences: `staging/proxy/proxy-walk-d45-0.png` through `-7.png`, and `proxy-attack_sword_01-d45-0.png` through `-7.png`. Ordering comes from JSON arrays, never directory names. The 800 ms walk has opposing planted/swing phases, analytic two-segment legs of constant 0.40/0.42-unit length and arms of 0.27/0.27-unit length (checked on export), controlled 0.044-unit maximum body bob and coordinated sword/lantern arms. During a planted half-cycle, the foot moves backward 0.72 units in 0.4 seconds, cancelling 1.8-unit/s gameplay travel. This math proves the intended contact-speed match; final visual polish and low-frame-rate foot sliding still require art review.

GIF previews retain all authored drawings with their holds rounded to GIF's 10 ms time quantum; runtime keeps exact durations. The 600 ms sword anticipates to 167 ms, strikes over 167–250 ms, then recovers. Export times are 0,100,167,200,250,350,450,550 ms; display holds total 600 ms. No action root motion is embedded. Limb/equipment movement changes across drawings; a global still-image bob is not used as the sample. The cyclic walk function returns to exactly the initial pose at 800 ms; the final sampled drawing holds 100 ms before wrapping. Canvas bounds, contact sheets and light/dark lab backgrounds are review evidence.

`export.py` is the authoritative editable parametric source for this technical proxy and reconstructs the `.blend` snapshot on each run. Change mesh dimensions, materials or pose curves there and replay the command. The `.blend` also contains named parts, grips, keyframes and canonical camera for inspection/direct editing; arbitrary edits made only to this generated snapshot are not consumed by the rebuild command. An artist-authored master `.blend` export adapter belongs to the post-approval hero assignment; don't lose manual edits by overwriting the snapshot. The script and original rendered PNGs are the complete current authoring truth.

## Replace frames without gameplay edits

Example: replace the d45 walk drawings with reviewed PNGs exported from the same camera and source density.

1. Put the exact-case lossless files under `staging/reviewed/`. Retain the untrimmed 384×432 canvas and (192,348) foot origin. Update provenance/license and recipe in `staging/source.json`.
2. Add stable frame IDs and paths to `frames`. Supply per-frame `attachments.lantern` in original source pixels. Set `origin` appropriately (`production` only after approval); keep the asset status `proxy` while mixed content remains.
3. Replace only `asset.clips.walk.d45.frames` and its corresponding positive `durationsMs`. Their order is explicit. Keep total motion cadence matched to intended travel; retain visual notify IDs and their authored offsets.
4. Run `assets:validate`, `assets:compile`, `assets:inspect`, and inspect that view in the actual lab over dark and light backgrounds. No movement, simulation, scene or renderer change is needed.
5. When a whole required kit and camera/design are approved, change the real contract approval/version and content provenance deliberately, mark frames/asset production, set `public/build-mode.json`'s `allowDevelopmentContent` false, and run `assets:production`. Current content correctly fails this gate.

A projection/angle change is a new bake contract, not an image-resize workaround. Regenerate all dependent directions and metadata. Higher-resolution exports at the same angles instead change density/canvas/anchor consistently.

## Schema and compiler policy

Zod schemas in `src/assets/schema.ts` generate TypeScript types with `z.infer`; structural and semantic validation share code offline/runtime. The source schema carries asset ID/type/version, bundle/provenance/status, bake ID/version, canvas/density/anchor, straight alpha/sRGB/recipe, render category, shadow, collision footprint ID, explicit vertical-plane depth policy, clips/headings/holds/notifies/fallbacks and dependencies. Runtime adds source mappings, per-frame trim/atlas rects, page IDs/dimensions/hashes/file+RGBA byte estimates and required/optional bundle resources. The format is intentionally one character definition for this slice; multiple archetype manifests can use the same loader interface later.

Validation rejects duplicate/case-colliding sources, incompatible bake, missing required clips/headings/frames, non-finite numbers, invalid anchors/attachments/durations, wrong image dimensions, empty frames, invalid rotation flags and out-of-bounds rectangles. Paths are restricted to real files below staging, with exact segment-case checks and symlink-root checks. A declared foot anchor may be outside opaque art and is not forced into the silhouette. Valid and invalid small fixtures live at `staging/fixtures/`.

Packing uses explicit source order, deterministic shelf placement, fixed 2048×2048 pages (max 4096; runtime checks renderer maximum). No rotated frames. RGB dilates three source pixels into alpha-zero neighbors without changing alpha; two pixels extrude the trim edge, with two further transparent gutter pixels. Straight alpha remains consistent through Bitmap decode, texture upload and materials. Linear min/mag filtering, no mipmaps and a fixed framing envelope avoid cross-frame mip bleeding; this is not a promise for arbitrary extreme minification. PNG first; no KTX2 dependency.

The hash covers canonical source JSON bytes, frame bytes, tool version and camera contract. All pages are encoded in a temporary directory before the content-addressed folder is published. `manifest.json` is replaced by atomic rename last; failed input leaves the old manifest intact. Old content-addressed folders are retained for safe in-flight consumers; prune retired folders during a deliberate asset-release cleanup, not while an old runtime is still loading them. The runtime pool itself is refcount-bounded and has no unlimited global cache.

## Approval gates and remaining art

Pending: lighter/distinctive male design, turnaround/handedness, camera/scale/density and first d45 walk/attack review. Only these disposable proxy exports were produced while approval is pending.

After approval: walk + sword in the remaining seven views, then authored idle/dodge/flare/hit/death in all eight; optional run only if speed design needs it. Produce one original enemy set and an environment kit using proven depth rules. Final silhouettes, facial/costume details, attack grip expressiveness and foot-contact polish remain art work.

A possible small kit is 8×(4 idle + 8 walk + 8 sword + 4 dodge + 6 flare + 3 hit + 6 death) = **312 drawings**. At roughly 200×300 trimmed pixels per drawing, that's 18.7 million pixels before gutter/packing, around 75 MiB base RGBA ideal occupancy and roughly 96–128 MiB practical pages; this is a planning estimate, not a measured finished kit. A second wholly baked loadout roughly doubles drawings and resident pages. Layered future equipment instead requires identical camera/canvas/anchor/timing, per-frame sockets and per-view front/behind masks/order. No complete equipment compositor is implemented.

The current `occlusion` value is `vertical-plane-preserved-projection-v1` (content version 0.1.1-proxy). The renderer derives vertex depth from elevation to keep the card vertical; the original baked projection, source density and anchor remain unchanged. This is an explicit depth approximation, not a new bake angle or undocumented image scaling.
