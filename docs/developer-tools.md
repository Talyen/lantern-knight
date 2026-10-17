# Developer tools

Run `npm run dev`; developer navigation connects Game, Dev Preview and the scene editor. Dev Preview lives at `/sandbox.html` and consolidates independent outdoor/interior/system fixtures, animation, calibration, occlusion, lighting and effects experiments. Game packages exclude developer screens and fixtures. [Development](development.md) owns setup and preview ports.

## Scene editor

Open `/editor.html`. The canvas-first workspace uses one right dock with Add, Objects and Scene. Add browses artwork and reusable arrangements. Objects shows the hierarchy; selecting an object opens its properties with Back to objects returning to the list. Scene starts with a compact overview and collapsed Ground, Movement & depth, Gameplay, Camera, Atmosphere and Advanced sections. Search (Cmd/Ctrl+K) finds actions and settings, opening the relevant section. The Scene menu owns New, Open scene, Save As, import/export and separate recovery history. Developer tools contains source inventory, media and developer navigation. The document title is editable inline.

### Composition and navigation

Browse artwork with optional filters, favorites and recent use. Clip/facing choices appear only when alternatives exist. Choosing artwork shows a placement ghost; placing opens object properties unless Keep placing is enabled. Escape cancels placement or an active transform. Shift-click or drag empty ground selects multiple placements. Numeric fields show shared or mixed values and edit the selection in one history step. Selection-bound handles move, rotate and scale the group; arrow keys nudge. Objects shows attachment hierarchy with focus, hide and lock actions; visibility and locks are editor-only.

WASD is always available on the focused canvas for a temporary hero scale preview with camera follow while moving and walk animation. Focus the canvas to move; movement respects the ground edge and scenery collision without running combat or changing the authored spawn. Escape restores the hero and prior framing; WASD starts another preview. Walking leaves ground authoring available. Scroll to zoom and middle/right-drag to pan. View → Reset game zoom restores the shared game camera scale; Fit scene frames the floor and Focus selection frames selected objects. View owns grid, movement constraints, overlays, framing and animation preview. Snap remains directly accessible, with spacing revealed in View while enabled. Focus hides the dock and tool strip; use its button or Tab from the canvas to restore the prior workspace. Shift+Tab retains ordinary keyboard navigation. At narrow widths the dock becomes a temporary overlay; Panel toggles it. Dock preferences are disposable browser metadata and do not change scene documents. [Scene design](scene-design.md) explains composition advice and technical protections.

Select and Set player start are explicit canvas tools; Set player start edits the saved spawn, while WASD only previews walking. Geometry and gameplay sections provide Edit on canvas actions. Play runs gameplay; its adjacent Test menu contains movement diagnostics, also available directly in Movement & depth.

Ground, camera framing and playable bounds are editable. Scene editor, dev-preview and Game constrain the entire camera viewport to the ground boundary. Camera follow stops at the edge while the hero can continue to it; movement stops with the hero’s collision radius inside the boundary. Oversized views zoom in to fit the floor, including after a viewport resize. Ground shows the current artwork independently of filtering. Change ground offers scene paintings and tiled materials with thumbnail previews; All compatible artwork retains experimental choices. Search ground by name or asset ID; High-res only (4K+) limits results to artwork with a longest canvas edge of at least 3840 pixels. Filtering preserves the current ground until you choose a result. Scene authoring controls expose paths, walls, graves, surfaces, entries, camera details, weather, shelters and surround layers. Geometry mode edits path/wall points and bounds in the viewport; optional overlays show collision, entries, camera limits, zones, lights and shelters. The object inspector edits appearance, attachment supports/sockets and light fixtures. Opening Weather shows the dry defaults without editing the scene; changing a weather value authors it in one undoable step.

Ground-standing props receive contact shadows automatically, using authored footprints when available and trimmed artwork dimensions otherwise. Appearance can disable shadows; ground artwork, mounted objects, effects and elevated props do not receive automatic contact shadows. The hero and other actors share the contact-shadow treatment, independently of directional shadows. Scene settings provide fixed sun direction and elevation, shared by the editor and gameplay. Direction is world-space (0° toward +Z, 90° toward +X); use a visual estimate of painted shadows and adjust it in the viewport. Opening controls does not author a sun; changing an angle saves the pair, and Use lighting preset sun removes the override. The sun does not move during gameplay. With scene shadows enabled, solid props, actors, dropped items and authored painted silhouettes cast shadows from the fixed sun and nearby lanterns, campfires and ability lights in the editor and gameplay. Appearance offers Cast or None; older Contact settings now include silhouette casting. Mounted solids can cast, while automatic ground contact remains limited to grounded objects.

Use Add → Arrangements to save selections to `authoring/fragments/` and insert independent copies. Arrange in object properties previews repetitions along a selected path or seeded scatter within a chosen circular region before committing one undoable batch. [Scene fragments](../authoring/fragments/README.md) describes what recipes retain.

### Saving and recovery

Save updates the current document; Save As creates another saved scene. A saved scene is a durable file; [Game content registration](architecture.md#add-an-area-or-enemy) determines whether Game uses it. Discard, import and attached-object deletion confirmations stay inside the editor. Cancel or Escape preserves the current work. Writes compare revisions and replace files atomically. If a file changed externally, preserve the scene, reload or save a separate copy. Editing never writes game checkpoints.

Reloading or closing the editor attempts local recovery without a browser warning. Recovery depends on browser storage; if the editor reports it unavailable, save the scene before leaving. It is scoped to the checkout and browser origin, so changing preview ports does not carry it over. Unreadable/older recovery stays available for JSON download before adaptation or explicit dismissal.

### Gameplay and playtests

Gameplay controls place registered enemies, exits and health pickups linked to upright artwork. Existing rooms inherit their gameplay definitions when the optional authored gameplay block is absent; new scenes start empty. Health pickups restore the authored amount up to maximum health, are consumed only when healing is useful, and retain collection state in ordinary checkpoints. Core owns these rules; artwork does not imply interaction behavior.

Play starts an unsaved snapshot through the shared Application lifecycle with a storage-free bridge. WASD moves, left-click attacks, Shift dodges, right-click uses the lantern, and Escape pauses. Play uses the main workspace with a compact Return/Restart bar. Return to editor discards gameplay state and preserves the scene, selection, camera and dock. Restart creates a fresh temporary session. Current schemas are listed under [scene content](architecture.md#scene-content) and [saved-state changes](architecture.md#change-saved-state).

Game starts in Abandoned Orchard and connects through Forest Gathering Clearing and Ruined Craftsman Forge to Desecrated Chapel. Use editor Play to test a scene directly, including drafts outside that route. For independent rendering fixtures, open `/sandbox.html?scene=outdoor-fixture` or `/sandbox.html?scene=interior-fixture`. Reload restores preview context. Moving existing artwork requires no preparation or publication; changed artwork inputs follow [Assets](assets.md#runtime-composition-boundary).

### Ground interaction

Open Scene → Movement & depth for single-image artwork floors on flat ground. Choose a region or New region, then Block movement, Hide hero behind scenery or Depth ordering. Drawing tools and pending-gesture actions appear only when relevant; Finish editing region returns to selection. Draw a blocking footprint independently from its occlusion silhouette, then place a depth anchor. AI assistance, overlays, saved interaction profiles and region actions are separate disclosures. Use a left-to-right depth boundary for diagonal walls; split compound structures when their ordering would be ambiguous. Masks support separate islands and holes. Select / edit vertices drags accepted polygon, hole, footprint and boundary vertices. Add/erase brushes work without AI. A completed gesture or accepted proposal is one history transaction; Escape cancels the gesture first.

AI box selection or include/exclude clicks produce a preview; Shift-click excludes. Run AI selection, review its device and time, correct it, then Accept mask. A mask does not infer collision. Crop selection with contextual padding and zoom in for branches and openings. A model prediction expanded to source dimensions does not establish source-pixel accuracy. Oversized edits fail visibly; save/export/recovery retain accepted vector contours up to 4 MiB. Ground overlays start hidden in each editor session; explicitly enable blocking footprints, occlusion masks or depth anchors and boundaries in Movement & depth. Overlay choices last only for the current session. Ground resizing reprojects footprints, depth and test annotations together; clear interaction before choosing replacement artwork.

#### Automatic scenery proposals

`npm run segmentation:inventory` lists prepared 4K+ scene paintings and the saved scenes that use them. It writes `scene-inventory.json` under the external model directory, without scanning source artwork or running inference. Use it to identify prepared grounds for authoring.

Automatic scenery proposals use local text-guided detection followed by SAM masks. Find scenery scans overlapping crops for the named categories. Prepare included masks processes its boxes serially without drawing them by hand. Review proposal previews, exclude duplicates or bad detections, then Accept prepared masks in one undoable transaction. Accepted base anchors are provisional; validate depth and author collision independently. The authoring agent owns corrections and movement validation before delivering a finished scene. Proposals are never accepted merely because the model gives a high confidence score.

After [local model setup](#local-foreground-selection-setup), `npm run segmentation:propose -- woodland` prepares resumable whole-scene proposals under the external model directory. Proposals resume only when artwork identity, model settings and category prompt match. The command preserves the scene file and records its artwork identity.

The CLI defaults to pine trees, dead trees, stone walls and large rocks. Pass a quoted second argument to choose categories for another painting, for example `npm run segmentation:propose -- crypt 'stone pillar. stone coffin.'`. Categories accept 1–300 characters; changing them starts a new proposal pass for that scene and artwork identity.

Review those proposals, author footprints and depth, inspect the scene, and save accepted scene data separately. Re-running asset preparation cannot overwrite those scene files: masks, blockers, depth and annotations live in `authoring/scenes`, outside generated assets. Re-encoding delivery metadata preserves a binding to unchanged lossless artwork. Changed painting bytes, frames or dimensions require review; validation preserves the authored file instead of clearing regions.

Draft paintings may use locally prepared ground artwork absent from the shared asset pin. Source-free CI validates their document geometry and available references, deferring only unavailable draft artwork floors. Play, editor saving, local scene validation and live scenes still require the prepared ground and matching interaction identity. Committing a draft does not publish its artwork.

#### Saved ground profiles

Saving through the editor also archives an immutable, content-addressed revision under `authoring/ground-profiles`. These authored files are independent of scenes, asset IDs, and generated asset output; keep them in Git. Deleting or recreating a scene, clearing its interaction data, and reprocessing or reorganizing artwork never removes earlier revisions. In Movement & depth → Saved interaction profiles, Find saved profiles and Restore selected profile restore a revision in one undoable operation, including holes, collision footprints, depth and annotations. Matching painting hashes can be reassigned to a new asset ID. Changed painting bytes or dimensions require enabling alignment review; old revisions remain intact. World geometry reprojects to the new floor dimensions, while normalized mask contours retain their artwork coordinates. Inspect changed-art alignment before using the restored scene. Profiles protect saved work; unsaved edits still depend on editor recovery.

#### Movement validation

Test movement beside Play starts a storage-free fixed-step sandbox. Select Hero or an enemy, click ground for a route, and use WASD to cancel the hero route. Enemies follow the hero until assigned a destination; Follow hero resumes pursuit. Pause, Restart and Return retain the ordinary editor playtest lifecycle. The sandbox disables combat; Play uses combat and shared navigation. Toggle blockers, masks, depth, cells, routes, footprints and hidden actor outlines while testing. Scenes can retain named test destinations in their ground-interaction annotations.

#### Depth audit and repair

Run `npm run occlusion:audit -- --output /absolute/path/report.json` to scan all saved scenes without loading artwork. The advisory report flags depth boundaries below the entire silhouette and masks extending beyond a boundary's horizontal span. Collision-valid rectangular actor probes supply reproduction positions; they do not prove the painting's intended ordering. Trees, roofs and hidden bases can produce valid warnings. The report records scene hashes and describes input geometry before any repair.

For visually reviewed solid props whose lower silhouette is their ground contact, generate a plan with `npm run occlusion:audit -- --contact-region scene-id:region-id --write-plan /absolute/path/repairs.json`. Repeat `--contact-region` for a batch. Inspect the proposed boundaries, then apply with `npm run occlusion:audit -- --apply-plan /absolute/path/repairs.json`. Application rejects changed scene revisions, modified proposals, duplicate selections and unsupported compound silhouettes before writing. It rebuilds only selected depth boundaries from the source-column lower envelope with a two-source-pixel simplification tolerance; masks, collision, artwork and earlier saved profiles remain intact. Re-run the audit and inspect front/behind movement in the renderer. Keep reports and plans outside Git.

#### Authored occlusion captures

For a visual review of a prepared local scene, run `LANTERN_GROUND_REVIEW=woodland npm run test:browser -- ground-review`. The diagnostic finds reachable front/behind actor positions for regions with masks and depth, then writes a PNG per region with a reachable approach and a `review.json` report under `.cache/browser-results/`. Inspect the images against the painting; reachable probes and successful capture do not establish correct occlusion or complete movement coverage. Scene files remain unchanged.

To resume a partial capture, copy its result directory outside the browser output first, then set `LANTERN_GROUND_REVIEW_RESUME` to that copy when repeating the command. Playwright clears its output directory on a new run. Reuse captures only while the scene, artwork and renderer are unchanged; the resume option carries forward images by region ID without checking those identities.

#### Authored scene timing capture

For an opt-in local timing capture, run `LANTERN_TEST_GPU=hardware LANTERN_GROUND_SCENE=woodland npm run test:browser -- authored-ground` against the prepared scene. On macOS this requests ANGLE Metal, records the reported renderer and rejects software fallback. Ordinary browser checks retain deterministic SwiftShader rendering. The capture records source-size atlas memory, scene opening time (including assets), and 120 frame intervals; it is a local diagnostic sample, not a packaged-game performance benchmark or a speedup comparison. Captures and JSON metrics stay under the external/ignored browser output.

### Local foreground selection setup

The setup script requires a POSIX shell, and the worker uses POSIX virtual-environment paths; native Windows model setup is not supported. Install Python 3.11 separately, then run `npm run segmentation:setup` explicitly. The default automatic mode installs SAM 2.1 Large and Grounding DINO Base under `~/Library/Application Support/LanternKnight/segmentation`; `LANTERN_SAM_ROOT` overrides that location. Use `npm run segmentation:setup -- small` for point/box selection with the smaller SAM model, or `npm run segmentation:setup -- large` without the detector. Setup pins Python requirements, SAM and detector revisions, and checkpoint SHA-256 values in `tools/segmentation/`. Run `npm run segmentation:smoke -- woodland` for separate real point/box inference against prepared local woodland artwork. Normal development, builds and checks never install the models. The CUDA extension is omitted, following [upstream installation guidance](https://github.com/facebookresearch/sam2/blob/main/INSTALL.md).

The authenticated same-origin editor endpoint resolves a prepared asset/frame and lazily starts a JSON-lines Python subprocess. Requests cannot name filesystem paths. Inference is serialized and retains at most two SAM crop embeddings. SAM tries MPS and falls back to CPU with the active device shown; the detector uses CPU. Inference loads installed weights locally and never uploads artwork. New selections, document changes and disposal invalidate stale results. Cancellation kills pending inference; the worker stops after five idle minutes or server shutdown. Failures leave manual authoring available. Weights, embeddings and diagnostics stay outside Git; accepted scenes reopen and play without Python.

## Dev Preview

The scene fills the window below a slim toolbar. Choose Outdoor, Interior, Systems, Orchard, Forge, Chapel or Effects, then open Animation, Visuals or Inspect. One floating inspector contains essential controls followed by collapsed advanced sections. Opening Visuals or Inspect preserves scene playback, camera and pause state. Clicking the active tool or closing the inspector hides its controls without leaving the current view.

Pause/Resume and Restart apply to the current scene or animation cycle.

The editor's Add browser and Dev Preview's Animation browser share the prepared artwork catalog, including enemy, breakable and loot/container animations. Usage filters offer All assets, In use and In this scene; Animated and type filters combine with search. In use follows game/fixture references and transitive asset dependencies, not catalog membership or loaded textures. In this scene follows the current fixture or unsaved editor document; placement and undo update it immediately. The editor starts with All assets, while Animation starts with Animated enabled. Animated clips and Still poses are separate clip groups. Non-hero artwork previews as one centered subject.

Animation enters dedicated asset playback; Return to scene restores the scene's pause and camera context. Timeline seeking and frame stepping are silent. Comparison supports treatment and original/directed timing; advanced controls expose stabilization, rigid sword, locomotion timing, zoom, backdrop and registration. Narrow windows frame comparison actors within the uncovered canvas strip.

Visuals exposes production light rigs and looks, original rendering and a separate all-effects-off comparison. Nested controls cover lighting response, depth of field, individual effects, scripted replay and render scale. The Effects fixture keeps Quiet ink/Richer HD-2D treatments, individual effects and outline experiments; it does not reinterpret them as production lighting looks. Comparisons preserve selected options. Controls requiring another fixture name it and offer an explicit switch.

Choose **Orchard**, **Clearing**, **Forge** or **Chapel** for production-art cohesion comparisons without adventure travel or checkpoint writes. Visuals → Scene cohesion independently selects Ink harmonization, Shared palette finish, Ground color bounce and Dense contact cores. The [scene treatment](scene-design.md#scene-cohesion) preserves source artwork. All four treatments start enabled in new previews; existing saved choices persist per fixture. Compare identical poses under Lantern night and Silver hour, then walk through painted shade and behind foreground scenery. Clearing, Forge and Chapel comparison copies omit unique rewards.

Inspect groups registration/collision overlays, camera framing, calibration reference view, occlusion positioning and an explicit enemy-freeze control. Calibration preserves scene context; Return to scene restores it. Opening Inspect alone never freezes enemies.

More options contains Game/Editor navigation, optional gameplay HUD, diagnostics, keyboard help, reset actions and Hide controls. HUD and diagnostics start hidden. Escape closes a menu/inspector first, restores hidden controls, otherwise pauses/resumes playback. Keyboard focus in controls cannot move or attack; focus returns to the tool button on inspector closure.

Session storage remembers each fixture's experiments, preview position/camera/pause context, animation choices and interface sections across switches/reloads. Combat outcomes are disposable, not restored checkpoints. Restart preserves experiments; Reset scene settings restores only the current fixture's defaults. Reset workspace confirms before clearing all remembered preview state. Invalid data starts fresh, and unavailable storage retains an in-memory workspace. Dev Preview cannot write player checkpoints or settings.

`/effects.html` redirects to the Effects fixture in Dev Preview. The shared shell preserves the existing application lifecycle and fixture-specific renderers. Artwork preparation follows [Assets](assets.md); moving between tools does not prepare or publish artwork.

## Checks and diagnostics

### Hero movement review

Open Inspect → Hero movement review. Travel speed changes only the current preview hero; run cadence and Game tuning stay fixed. Replay an out-and-back stride, all eight headings, or movement into the fixture boundary. Stop, Restart, switching fixtures or opening animation review cancels the replay. Selected uses the 3 m/s comparison preset; Original uses 1.8 m/s. Game's current speed comes from `tuning.moveSpeed` in [gameplay tuning](../src/content/gameplay.ts). Reloading restores the default speed; these experiments are excluded from checkpoints.

### Sweep review

Open Inspect → Sweep review to compare the selected Sword Finisher 03 and Contact Shear feedback. The crescent uses camera-correct pre-painted views and uniform scale per facing. Sweep defaults to 2.15 m reach and a 180° sector; lunge keeps its own reach and angle.

Enable Hit area guides to show the ground boundary in blue and the same boundary at the effect midpoint in gold. The replay begins with a miss, then repeats five numbered probes: near, inside range, outside range, inside angle and outside angle. Accepted hits turn their rings gold. Single enemy mode provides an uncluttered timing comparison. Stop returns control; Restart restores normal fixture actors.

Timing choices share the 100 ms damage window, hit area, damage amount and Contact Shear:

| Preset          | First damage | Total duration |
| --------------- | ------------ | -------------- |
| Baseline        | 300 ms       | 900 ms         |
| Snap            | 200 ms       | 700 ms         |
| Weight          | 250 ms       | 800 ms         |
| Quick (default) | 167 ms       | 600 ms         |

Timing overrides change simulation, cel holds, notifies and effect playback together at the next available action. Down-right recovery defaults to Canonical final pose: replace only the final drawing with the canonical idle frame while preserving the penultimate pose, action duration and damage beats. Original ending and Clean settle to idle remain available for comparison.

Game and Dev Preview share the Quick timing and Canonical final pose defaults. Preview overrides reset on reload and are excluded from checkpoints. Contact Shear appears for positive direct damage, including hero sword/lantern hits and incoming enemy hits. Burn ticks retain their persistent cue without replaying Contact Shear or impact sounds. Stop, Restart, fixture changes and dedicated animation review clear transient feedback.

### Automated diagnostics

CI runs `npm run test:browser -- editor` for authoring/history/recovery changes, `scene` for room presentation and preview interactions, and `effects` for remembered effect experiments and fixture switching. Use these locally for targeted diagnosis or validation. [Verification](verification.md#test-selection) owns selection and coverage.

For explicit native investigations, `npm run benchmark -- scene` checks fixture traversal, foreground/surround rendering, reload and settled resources. `scenes` checks fixture-specific weather and effects; `preferences` checks Game visual-setting persistence. Package prerequisites are listed in [diagnostics and measurements](verification.md#diagnostics-and-measurements). `npm run benchmark -- effects` checks rendered differences, baseline restoration, playback, resources and routing. Lighting smoke measures performance only with `--benchmark` or `--benchmark-only`; ordinary assertions have no benchmark waits. Use `--capture` for requested exports. Animation capture writes native PNGs and an `index.html` gallery; each image opens at its original framebuffer dimensions. [Performance comparisons](verification.md#performance-comparisons) explains evidence limits.

## Motion and effect review

Development Game accepts `?motion-probe` to show frame p50/p95/p99 and retain a bounded recording in the diagnostic output's `data-recording` attribute. Samples include frame intervals, simulation steps, interpolation alpha, interpolated hero position, camera position and a stationary landmark's projected position. Compare straight runs, collisions and camera edges with matching viewport, resolution and effects; average FPS alone does not establish uniform motion. Run actual Safari visibly without another GPU test competing for the machine.

Development Game query parameters `wind-preview=gust|leaves|combined` and `dodge-preview=dust|leaves|combined` select supplied-artwork comparisons. `lighting-preview=lantern|golden|silver` compares the shared lighting rigs in Game. Dev Preview's Scene effects controls expose the wind and Dodge treatments. Production Game ignores these review parameters. Captures and recordings stay outside Git.

### Opening comparison captures

Two opt-in browser suites capture the current opening and supplied effects. Replace `/external/...` below with your own absolute output directories outside the repository. Choose an unused preview port and run the relevant suite:

```sh
LANTERN_PREVIEW_PORT=5175 LANTERN_ORCHARD_DESIGN_CAPTURES=/external/orchard-composition npm run test:browser -- orchard-design
LANTERN_PREVIEW_PORT=5175 LANTERN_OPENING_CAPTURE_DIRECTORY=/external/opening-effects npm run test:browser -- orchard-polish
```

`orchard-design` checks rejected hidden-body placement and captures the orchard's work areas and lighting comparisons. `orchard-polish` captures wind, Dodge, lantern/Lunge effects, run-contact drawings and placements. Both use development previews and skip without their output variable. These are diagnostics tied to current authored content; successful captures do not certify composition, animation or visual quality. Inspect the images and retain only the evidence needed outside Git.
