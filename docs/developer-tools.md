# Developer tools

Run `npm run dev`; developer navigation connects Game, Sandbox and the scene editor. The Sandbox scene selector includes the opening rooms, systems fixture and dedicated effects test scene. Sandbox includes animation, calibration, occlusion and Lighting & Look modes. Game packages exclude developer screens and fixtures. [Development](development.md) owns setup and preview ports.

## Scene editor

Open `/editor.html`. Start a flat draft, open any discovered document, or copy the current scene. Live documents remain directly editable with revision-checked Save. Browse grouped artwork with clip/facing choices, favorites and recent use. Preview artwork or move its placement ghost before placing one object. Shift-click or drag empty ground to select multiple placements; use group handles, arrow nudging, duplicate/delete and undo/redo. Grid visibility and optional snapping are independent. The Object/Scene inspector tabs and searchable attachment outliner keep editing controls accessible; hide/lock are editor-only. Panels resize/collapse and remember their layout. [Scene design](scene-design.md) explains composition advice and technical protections.

Ground, camera framing and playable bounds are editable. Scene authoring controls expose paths, walls, graves, surfaces, entries, camera details, weather, shelters and surround layers. Geometry mode edits path/wall points and bounds in the viewport; optional overlays show collision, entries, camera limits, zones, lights and shelters. The object inspector edits appearance, attachment supports/sockets and light fixtures. The scene library imports/exports JSON, lists timestamped recovery, and saves independent arrangements to `authoring/fragments/`. Repeat-along-path and seeded scatter preview arrangement centers before committing one undoable batch. Old drafts require manual adaptation.

Save updates the current document; Save As creates a draft copy. Recovery preserves unsaved work across reloads. Unreadable/older recovery stays available for JSON download before adaptation or explicit dismissal. Writes compare revisions and replace files atomically. If a file changed externally, preserve the draft, reload or save a separate copy. Editing never writes game checkpoints.

Gameplay controls place registered enemies, exits and health pickups linked to upright artwork. Existing rooms inherit their gameplay definitions when the optional authored gameplay block is absent; blank drafts start empty. Health pickups restore the authored amount up to maximum health, are consumed only when healing is useful, and retain collection state in ordinary checkpoints. Core owns these rules; artwork does not imply interaction behavior.

Play from here starts an unsaved snapshot through the shared Application lifecycle with a storage-free bridge. WASD moves, left-click attacks, Shift dodges, right-click uses the lantern, and Escape pauses. Return to editor discards gameplay state and preserves the draft, selection and camera. Restart creates a fresh temporary session. Prototype scene version 5 and save version 6 accept the additive gameplay/collection fields; unsupported recovery remains downloadable.

For a room preview, open `/sandbox.html?scene=court` (Graveyard Approach) or `/sandbox.html?scene=upper-landing` (Ruined Chapel). Reload restores preview context. Moving existing artwork requires no preparation or publication; changed artwork inputs follow [Assets](assets.md#runtime-composition-boundary).

## Lighting and Look

Sandbox's Lighting & Look mode compares Golden/Silver hour with Atmospheric ink, HD-2D diorama and Dark cinematic. It exposes original rendering, independent effects, light response, pause and fixed replay controls using shared production presentation. [Game design](game-design.md#presentation-and-delivery-defaults) owns initial visual defaults; saved preferences remain authoritative. Depth of field starts at 100%.

Alpha-derived normal companions bind to the exact source page, trim and crop; authored surface companions add structural response. Shadow, focus, foliage and reveal passes share registration/deformation. SMAA handles antialiasing, auxiliary masks protect fighters and combat cues, and interiors exclude outdoor haze and rain.

## Effects Playground

Choose Effects test scene in Sandbox to compare living lights, smoke/embers, rain, surface normals, relief, wind, atmosphere, palette, bloom, wetness, outlines, contact grounding and shafts. It supports quiet/richer treatments, an all-off baseline that preserves selected options, pause, replay and switching back to the opening rooms. `/effects.html` redirects to this scene. Its disposable session does not change persistent production settings.

Prepared ambience artwork and companion data come from the selected asset workspace. Runtime owns weather scheduling, shaders and materials; these changes need preparation only when their artwork-producing inputs change.

## Checks and diagnostics

CI runs `npm run test:browser -- editor` for authoring/history/recovery changes, `scene` for room presentation, and `effects` for effects comparison and switching between dedicated and production scenes. Use these locally for targeted diagnosis or validation. [Verification](verification.md#test-selection) owns selection and coverage.

For explicit native investigations, `npm run benchmark -- crypt`, `preferences` or `scenes` checks frozen frames, depth/focus protection, weather and settled resources. `npm run benchmark -- effects` checks rendered differences, baseline restoration, playback, resources and routing. Lighting smoke measures performance only with `--benchmark` or `--benchmark-only`; ordinary assertions have no benchmark waits. Use `--capture` for requested exports. [Performance comparisons](verification.md#performance-comparisons) explains evidence limits.
