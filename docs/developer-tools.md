# Developer tools

Run `npm run dev`; developer navigation connects Game, Dev Preview and the scene editor. Dev Preview lives at `/sandbox.html` and consolidates independent outdoor/interior/system fixtures, animation, calibration, occlusion, lighting and effects experiments. Game packages exclude developer screens and fixtures. [Development](development.md) owns setup and preview ports.

## Scene editor

Open `/editor.html`. The canvas-first workspace uses one right dock for Artwork, Inspector, Objects and Scene. Scene settings and object properties reveal their advanced sections on demand; setting search opens the relevant section. The Scene menu owns New/Open, copies, import/export and recovery history. The document title is editable inline. Commands (Cmd/Ctrl+K) searches actions and dock destinations.

Browse artwork with optional filters, favorites and recent use. Clip/facing choices appear only when alternatives exist. Choosing artwork shows a placement ghost; placing returns to the Inspector unless Keep placing is enabled. Escape cancels placement or an active transform. Shift-click or drag empty ground selects multiple placements. Numeric fields show shared or mixed values and edit the selection in one history step. Selection-bound handles move, rotate and scale the group; arrow keys nudge. The Objects dock shows attachment hierarchy with focus, hide and lock actions; visibility and locks are editor-only.

Walk hero enables a temporary WASD scale preview with camera follow and walk animation. Focus the canvas to move; movement respects the ground edge and scenery collision without running combat or changing the authored spawn. Escape or Stop walking restores the hero and prior framing. View owns grid, movement constraints, overlays, framing and animation preview. Snap remains directly accessible, with spacing revealed in View while enabled. Focus hides the dock and tool strip; use its button or Tab from the canvas to restore the prior workspace. Shift+Tab retains ordinary keyboard navigation. At narrow widths the dock becomes a temporary overlay; Panel toggles it. Dock preferences are disposable browser metadata and do not change scene documents. [Scene design](scene-design.md) explains composition advice and technical protections.

Ground, camera framing and playable bounds are editable. Scene editor, dev-preview and Game constrain the entire camera viewport to the ground boundary. Camera follow stops at the edge while the hero can continue to it; movement stops with the hero’s collision radius inside the boundary. Oversized views zoom in to fit the floor, including after a viewport resize. Search ground by name or asset ID; High-res only (4K+) limits results to artwork with a longest canvas edge of at least 3840 pixels. Filtering preserves the current ground until you choose a result. Scene authoring controls expose paths, walls, graves, surfaces, entries, camera details, weather, shelters and surround layers. Geometry mode edits path/wall points and bounds in the viewport; optional overlays show collision, entries, camera limits, zones, lights and shelters. The object inspector edits appearance, attachment supports/sockets and light fixtures.

Use Artwork → Arrangements to save selections to `authoring/fragments/` and insert independent copies. Arrange in the Inspector previews repetitions along a selected path or seeded scatter within a chosen circular region before committing one undoable batch. [Scene fragments](../authoring/fragments/README.md) describes what recipes retain.

Save updates the current document; Save As creates a draft copy. Discard, import and attached-object deletion confirmations stay inside the editor. Cancel or Escape preserves the current work. Reloading or closing the editor saves recovery without a browser warning; recovery preserves unsaved work across reloads. Unreadable/older recovery stays available for JSON download before adaptation or explicit dismissal. Writes compare revisions and replace files atomically. If a file changed externally, preserve the draft, reload or save a separate copy. Editing never writes game checkpoints.

Gameplay controls place registered enemies, exits and health pickups linked to upright artwork. Existing rooms inherit their gameplay definitions when the optional authored gameplay block is absent; blank drafts start empty. Health pickups restore the authored amount up to maximum health, are consumed only when healing is useful, and retain collection state in ordinary checkpoints. Core owns these rules; artwork does not imply interaction behavior.

Play starts an unsaved snapshot through the shared Application lifecycle with a storage-free bridge. WASD moves, left-click attacks, Shift dodges, right-click uses the lantern, and Escape pauses. Play uses the main workspace with a compact Return/Restart bar. Return to editor discards gameplay state and preserves the draft, selection, camera and dock. Restart creates a fresh temporary session. Current schemas are listed under [scene content](architecture.md#scene-content) and [saved-state changes](architecture.md#change-saved-state).

Game launches an empty floor with the hero. Use editor Play for authored scenes. For independent rendering fixtures, open `/sandbox.html?scene=outdoor-fixture` or `/sandbox.html?scene=interior-fixture`. Reload restores preview context. Moving existing artwork requires no preparation or publication; changed artwork inputs follow [Assets](assets.md#runtime-composition-boundary).

### Ground interaction

Open the Scene dock → Ground interaction for single-image artwork floors on flat ground. Choose a region or New region. Draw a blocking footprint independently from its occlusion silhouette, then place a depth anchor. Use a left-to-right depth boundary for diagonal walls; split compound structures when their ordering would be ambiguous. Masks support separate islands and holes. Select / edit vertices drags accepted polygon, hole, footprint and boundary vertices. Add/erase brushes work without AI. A completed gesture or accepted proposal is one history transaction; Escape cancels the gesture first.

AI box selection or include/exclude clicks produce a preview; Shift-click excludes. Run AI selection, review its device and time, correct it, then Accept mask. A mask does not infer collision. Crop selection with contextual padding and zoom in for branches and openings. A model prediction expanded to source dimensions does not establish source-pixel accuracy. Oversized edits fail visibly; save/export/recovery retain accepted vector contours up to 4 MiB. Overlays are disposable preferences. Ground resizing reprojects footprints, depth and test annotations together; clear interaction before choosing replacement artwork.

Automatic scenery proposals use local text-guided detection followed by SAM masks. Find scenery scans overlapping crops for the named categories. Prepare included masks processes its boxes serially without drawing them by hand. Review proposal previews, exclude duplicates or bad detections, then Accept prepared masks in one undoable transaction. Accepted base anchors are provisional; validate depth and author collision independently. The authoring agent owns corrections and movement validation before delivering a finished scene. Proposals are never accepted merely because the model gives a high confidence score.

For agent authoring, `npm run segmentation:propose -- woodland` prepares resumable whole-scene proposals under the external model directory. It preserves the scene file and records its artwork identity. Review those proposals, author footprints and depth, inspect the scene, and save accepted scene data separately. Re-running asset preparation cannot overwrite those scene files: masks, blockers, depth and annotations live in `authoring/scenes`, outside generated assets. Re-encoding delivery metadata preserves a binding to unchanged lossless artwork. Changed painting bytes, frames or dimensions require review; validation preserves the authored file instead of clearing regions.

Saving through the editor also archives an immutable, content-addressed revision under `authoring/ground-profiles`. These authored files are independent of scenes, asset IDs, and generated asset output; keep them in Git. Deleting or recreating a scene, clearing its interaction data, and reprocessing or reorganizing artwork never removes earlier revisions. In Ground interaction, Find saved profiles and Restore selected profile restore a revision in one undoable operation, including holes, collision footprints, depth and annotations. Matching painting hashes can be reassigned to a new asset ID. Changed painting bytes or dimensions require enabling alignment review; old revisions remain intact. World geometry reprojects to the new floor dimensions, while normalized mask contours retain their artwork coordinates. Inspect changed-art alignment before using the restored scene. Profiles protect saved work; unsaved edits still depend on editor recovery.

Test movement beside Play starts a storage-free fixed-step sandbox. Select Hero or an enemy, click ground for a route, and use WASD to cancel the hero route. Enemies follow the hero until assigned a destination; Follow hero resumes pursuit. Pause, Restart and Return retain the ordinary editor playtest lifecycle. The sandbox disables combat; Play uses combat and shared navigation. Toggle blockers, masks, depth, cells, routes, footprints and hidden actor outlines while testing. Scenes can retain named test destinations in their ground-interaction annotations.

For an opt-in local timing capture, run `LANTERN_TEST_GPU=hardware LANTERN_GROUND_SCENE=woodland npm run test:browser -- authored-ground` against the prepared scene. On macOS this requests ANGLE Metal, records the reported renderer and rejects software fallback. Ordinary browser checks retain deterministic SwiftShader rendering. The capture records source-size atlas memory, scene opening time (including assets), and 120 frame intervals; it is a local diagnostic sample, not a packaged-game performance benchmark or a speedup comparison. Captures and JSON metrics stay under the external/ignored browser output.

### Local foreground selection setup

Install Python 3.11 separately, then run `npm run segmentation:setup` explicitly. The default automatic mode installs SAM 2.1 Large and Grounding DINO Base under `~/Library/Application Support/LanternKnight/segmentation`; `LANTERN_SAM_ROOT` overrides that location. Use `npm run segmentation:setup -- small` for point/box selection with the smaller SAM model, or `-- large` without the detector. Setup pins Python requirements, SAM and detector revisions, and both checkpoint SHA-256 values in `tools/segmentation/`. Run `npm run segmentation:smoke -- woodland` for separate real point/box inference against prepared local woodland artwork. Normal development, builds and checks never install the models. The CUDA extension is omitted, following [upstream installation guidance](https://github.com/facebookresearch/sam2/blob/main/INSTALL.md).

The authenticated same-origin editor endpoint resolves a prepared asset/frame and lazily starts a JSON-lines Python subprocess. Requests cannot name filesystem paths. Inference is serialized and retains at most two SAM crop embeddings. SAM tries MPS and falls back to CPU with the active device shown; the detector uses CPU. Inference loads installed weights locally and never uploads artwork. New selections, document changes and disposal invalidate stale results. Cancellation kills pending inference; the worker stops after five idle minutes or server shutdown. Failures leave manual authoring available. Weights, embeddings and diagnostics stay outside Git; accepted scenes reopen and play without Python.

## Dev Preview

The scene fills the window below a slim toolbar. Choose Outdoor, Interior, Systems or Effects, then open Animation, Visuals or Inspect. One floating inspector contains essential controls followed by collapsed advanced sections. Opening Visuals or Inspect preserves scene playback, camera and pause state. Clicking the active tool or closing the inspector hides its controls without leaving the current view.

Pause/Resume and Restart apply to the current scene or animation cycle.

The editor's Artwork browser and Dev Preview's Animation browser share the prepared artwork catalog, including enemy, breakable and loot/container animations. Usage filters offer All assets, In use and In this scene; Animated and type filters combine with search. In use follows game/fixture references and transitive asset dependencies, not catalog membership or loaded textures. In this scene follows the current fixture or unsaved editor document; placement and undo update it immediately. The editor starts with All assets, while Animation starts with Animated enabled. Animated clips and Still poses are separate clip groups. Non-hero artwork previews as one centered subject.

Animation enters dedicated asset playback; Return to scene restores the scene's pause and camera context. Timeline seeking and frame stepping are silent. Comparison supports treatment and original/directed timing; advanced controls expose stabilization, rigid sword, locomotion timing, zoom, backdrop and registration. Narrow windows frame comparison actors within the uncovered canvas strip.

Visuals exposes production light rigs and looks, original rendering and a separate all-effects-off comparison. Nested controls cover lighting response, depth of field, individual effects, scripted replay and render scale. The Effects fixture keeps Quiet ink/Richer HD-2D treatments, individual effects and outline experiments; it does not reinterpret them as production lighting looks. Comparisons preserve selected options. Controls requiring another fixture name it and offer an explicit switch.

Inspect groups registration/collision overlays, camera framing, calibration reference view, occlusion positioning and an explicit enemy-freeze control. Calibration preserves scene context; Return to scene restores it. Opening Inspect alone never freezes enemies.

More options contains Game/Editor navigation, optional gameplay HUD, diagnostics, keyboard help, reset actions and Hide controls. HUD and diagnostics start hidden. Escape closes a menu/inspector first, restores hidden controls, otherwise pauses/resumes playback. Keyboard focus in controls cannot move or attack; focus returns to the tool button on inspector closure.

Session storage remembers each fixture's experiments, preview position/camera/pause context, animation choices and interface sections across switches/reloads. Combat outcomes are disposable, not restored checkpoints. Restart preserves experiments; Reset scene settings restores only the current fixture's defaults. Reset workspace confirms before clearing all remembered preview state. Invalid data starts fresh, and unavailable storage retains an in-memory workspace. Dev Preview cannot write player checkpoints or settings.

`/effects.html` redirects to the Effects fixture in Dev Preview. The shared shell preserves the existing application lifecycle and fixture-specific renderers. Artwork preparation follows [Assets](assets.md); moving between tools does not prepare or publish artwork.

## Checks and diagnostics

### Hero movement review

Open Inspect → Hero movement review. Travel speed changes only the current preview hero; run cadence and Game tuning stay fixed. Replay an out-and-back stride, all eight headings, or movement into the fixture boundary. Stop, Restart, switching fixtures or opening animation review cancels the replay. Choose Selected for the current 3 m/s or Original for the former 1.8 m/s. Reloading restores the default speed; these experiments are excluded from checkpoints.

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

Game and Dev Preview share the Quick timing and Canonical final pose defaults. Preview overrides reset on reload and are excluded from checkpoints. Contact Shear appears for every positive damage event, including hero sword/lantern attacks and incoming enemy damage. Stop, Restart, fixture changes and dedicated animation review clear transient feedback.

### Automated diagnostics

CI runs `npm run test:browser -- editor` for authoring/history/recovery changes, `scene` for room presentation and preview interactions, and `effects` for remembered effect experiments and fixture switching. Use these locally for targeted diagnosis or validation. [Verification](verification.md#test-selection) owns selection and coverage.

For explicit native investigations, `npm run benchmark -- scene` checks fixture traversal, foreground/surround rendering, reload and settled resources. `scenes` checks fixture-specific weather and effects; `preferences` checks Game visual-setting persistence. Package prerequisites are listed in [diagnostics and measurements](verification.md#diagnostics-and-measurements). `npm run benchmark -- effects` checks rendered differences, baseline restoration, playback, resources and routing. Lighting smoke measures performance only with `--benchmark` or `--benchmark-only`; ordinary assertions have no benchmark waits. Use `--capture` for requested exports. [Performance comparisons](verification.md#performance-comparisons) explains evidence limits.
