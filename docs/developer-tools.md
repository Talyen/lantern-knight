# Developer tools

Run `npm run dev`; developer navigation connects Game, Sandbox and the scene editor. The Sandbox scene selector includes the opening rooms, systems fixture and dedicated effects test scene. Sandbox includes animation, calibration, occlusion and Lighting & Look modes. Game packages exclude developer screens and fixtures. [Development](development.md) owns setup and preview ports.

## Scene editor

Open `/editor.html`. Start a flat draft, copy either room, or edit its live document. Search/drag artwork, select placements, adjust transforms, duplicate/delete, and use undo/redo. [Scene design](scene-design.md) explains composition advice and technical protections.

Ground, camera framing and playable bounds are editable. Version 5 scene documents also contain surrounds, paths, supports and scene geometry; edit fields directly when the inspector does not expose them. Old drafts require manual adaptation.

Save updates the current document; Save As creates a draft copy. Recovery preserves unsaved work across reloads. Unreadable/older recovery stays available for JSON download before adaptation or explicit dismissal. Writes compare revisions and replace files atomically. If a file changed externally, preserve the draft, reload or save a separate copy. Editing never writes game checkpoints.

For a room preview, open `/sandbox.html?scene=court` (Graveyard Approach) or `/sandbox.html?scene=upper-landing` (Ruined Chapel). Reload restores preview context. Moving existing artwork requires no preparation or publication; changed artwork inputs follow [Assets](assets.md#runtime-composition-boundary).

## Lighting and Look

Sandbox's Lighting & Look mode compares Golden/Silver hour with Atmospheric ink, HD-2D diorama and Dark cinematic. It exposes original rendering, independent effects, light response, pause and fixed replay controls using shared production presentation. [Game design](game-design.md#presentation-and-delivery-defaults) owns initial visual defaults; saved preferences remain authoritative. Depth of field starts at 100%.

Alpha-derived normal companions bind to the exact source page, trim and crop; authored surface companions add structural response. Shadow, focus, foliage and reveal passes share registration/deformation. SMAA handles antialiasing, auxiliary masks protect fighters and combat cues, and interiors exclude outdoor haze and rain.

## Effects Playground

Choose Effects test scene in Sandbox to compare living lights, smoke/embers, rain, surface normals, relief, wind, atmosphere, palette, bloom, wetness, outlines, contact grounding and shafts. It supports quiet/richer treatments, an all-off baseline that preserves selected options, pause, replay and switching back to the opening rooms. `/effects.html` redirects to this scene. Its disposable session does not change persistent production settings.

Prepared ambience artwork and companion data come from the selected asset workspace. Runtime owns weather scheduling, shaders and materials; these changes need preparation only when their artwork-producing inputs change.

## Checks and diagnostics

Run `npm run test:browser -- editor` for authoring/history/recovery changes, `scene` for room presentation, and `effects` for effects comparison and switching between dedicated and production scenes. [Verification](verification.md#test-selection) owns selection and coverage.

For explicit native investigations, `npm run benchmark -- crypt`, `preferences` or `scenes` checks frozen frames, depth/focus protection, weather and settled resources. `npm run benchmark -- effects` checks rendered differences, baseline restoration, playback, resources and routing. Lighting smoke measures performance only with `--benchmark` or `--benchmark-only`; ordinary assertions have no benchmark waits. Use `--capture` for requested exports. [Performance comparisons](verification.md#performance-comparisons) explains evidence limits.
