# Developer tools

Run `npm run dev`; developer navigation connects Game, Sandbox and the scene editor. The Sandbox scene selector includes independent outdoor/interior fixtures, the systems fixture and dedicated effects test scene. Sandbox includes animation, calibration, occlusion and Lighting & Look modes. Game packages exclude developer screens and fixtures. [Development](development.md) owns setup and preview ports.

## Scene editor

Open `/editor.html`. The canvas-first workspace uses one right dock for Artwork, Inspector, Objects and Scene. Scene settings and object properties reveal their advanced sections on demand; setting search opens the relevant section. The Scene menu owns New/Open, copies, import/export and recovery history. Save updates the current document; live documents remain revision-checked. The document title is editable inline. Commands (Cmd/Ctrl+K) searches actions and dock destinations.

Browse artwork with optional filters, favorites and recent use. Clip/facing choices appear only when alternatives exist. Choosing artwork shows a placement ghost; placing returns to the Inspector unless Keep placing is enabled. Escape cancels placement or an active transform. Shift-click or drag empty ground selects multiple placements. Numeric fields show shared or mixed values and edit the selection in one history step. Selection-bound handles move, rotate and scale the group; arrow keys nudge. The Objects dock shows attachment hierarchy with focus, hide and lock actions; visibility and locks are editor-only.

View owns grid, movement constraints, overlays, framing and animation preview. Snap remains directly accessible, with spacing revealed in View while enabled. Focus hides the dock and tool strip; use its button or Tab from the canvas to restore the prior workspace. Shift+Tab retains ordinary keyboard navigation. At narrow widths the dock becomes a temporary overlay; Panel toggles it. Dock preferences are disposable browser metadata and do not change scene documents. [Scene design](scene-design.md) explains composition advice and technical protections.

Ground, camera framing and playable bounds are editable. Scene authoring controls expose paths, walls, graves, surfaces, entries, camera details, weather, shelters and surround layers. Geometry mode edits path/wall points and bounds in the viewport; optional overlays show collision, entries, camera limits, zones, lights and shelters. The object inspector edits appearance, attachment supports/sockets and light fixtures. The Scene menu imports/exports JSON and lists timestamped recovery. Arrangements in Artwork saves selections to `authoring/fragments/` and inserts independent copies. Arrange in the Inspector previews repetitions along a selected path or seeded scatter within a chosen circular region before committing one undoable batch. Old drafts require manual adaptation.

Save updates the current document; Save As creates a draft copy. Recovery preserves unsaved work across reloads. Unreadable/older recovery stays available for JSON download before adaptation or explicit dismissal. Writes compare revisions and replace files atomically. If a file changed externally, preserve the draft, reload or save a separate copy. Editing never writes game checkpoints.

Gameplay controls place registered enemies, exits and health pickups linked to upright artwork. Existing rooms inherit their gameplay definitions when the optional authored gameplay block is absent; blank drafts start empty. Health pickups restore the authored amount up to maximum health, are consumed only when healing is useful, and retain collection state in ordinary checkpoints. Core owns these rules; artwork does not imply interaction behavior.

Play starts an unsaved snapshot through the shared Application lifecycle with a storage-free bridge. WASD moves, left-click attacks, Shift dodges, right-click uses the lantern, and Escape pauses. Play uses the main workspace with a compact Return/Restart bar. Return to editor discards gameplay state and preserves the draft, selection, camera and dock. Restart creates a fresh temporary session. Prototype scene version 5 and save version 6 accept the additive gameplay/collection fields; unsupported recovery remains downloadable.

Game launches an empty floor with the hero. Use editor Play for authored scenes. For independent rendering fixtures, open `/sandbox.html?scene=outdoor-fixture` or `/sandbox.html?scene=interior-fixture`. Reload restores preview context. Moving existing artwork requires no preparation or publication; changed artwork inputs follow [Assets](assets.md#runtime-composition-boundary).

## Lighting and Look

Sandbox's Lighting & Look mode compares Golden/Silver hour with Atmospheric ink, HD-2D diorama and Dark cinematic. It exposes original rendering, independent effects, light response, pause and fixed replay controls using shared production presentation. [Game design](game-design.md#presentation-and-delivery-defaults) owns initial visual defaults; saved preferences remain authoritative. Depth of field starts at 100%.

Alpha-derived normal companions bind to the exact source page, trim and crop; authored surface companions add structural response. Shadow, focus, foliage and reveal passes share registration/deformation. SMAA handles antialiasing, auxiliary masks protect fighters and combat cues, and interiors exclude outdoor haze and rain.

## Effects Playground

Choose Effects test scene in Sandbox to compare living lights, smoke/embers, rain, surface normals, relief, wind, atmosphere, palette, bloom, wetness, outlines, contact grounding and shafts. It supports quiet/richer treatments, an all-off baseline that preserves selected options, pause, replay and switching back to independent scene fixtures. `/effects.html` redirects to this scene. Its disposable session does not change persistent production settings.

Prepared ambience artwork and companion data come from the selected asset workspace. Runtime owns weather scheduling, shaders and materials; these changes need preparation only when their artwork-producing inputs change.

## Checks and diagnostics

CI runs `npm run test:browser -- editor` for authoring/history/recovery changes, `scene` for room presentation, and `effects` for effects comparison and switching between effects experiments and independent fixtures. Use these locally for targeted diagnosis or validation. [Verification](verification.md#test-selection) owns selection and coverage.

For explicit native investigations, `npm run benchmark -- scene`, `preferences` or `scenes` checks frozen frames, depth/focus protection, weather and settled resources. `npm run benchmark -- effects` checks rendered differences, baseline restoration, playback, resources and routing. Lighting smoke measures performance only with `--benchmark` or `--benchmark-only`; ordinary assertions have no benchmark waits. Use `--capture` for requested exports. [Performance comparisons](verification.md#performance-comparisons) explains evidence limits.
