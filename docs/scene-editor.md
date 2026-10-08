# Scene editor

Run `npm run scene:editor` to open the local browser editor with the pinned artwork. It shares the scene preview server and game renderer. Keep the command running while editing; stop it when finished if it started the server. The editor's filesystem saves require this local server, even when viewing the developer build.

## Compose a scene

Open a new flat scene or a copy of Graveyard Approach or Ruined Chapel. Search the artwork palette and drag a thumbnail onto the ground. Alternatively, select a thumbnail and click to place it. The palette uses prepared clean-ink scenery and ground details, including the study artwork used by the current game; animated, diagnostic, and unsupported projections are excluded.

Select an object in the viewport or object list. Drag to move it, or adjust position, height offset, size, and mirroring in the inspector. Ground details also support rotation. Grid & snap places roots on half-unit increments. Right-drag or middle-drag pans; scrolling zooms; Fit scene restores the framing. Move hero lets you drag the hero reference for scale without running gameplay.

Duplicate and Delete operate on the selected editable object. Undo/Redo covers composition changes, including inspector edits and hero position. Keyboard shortcuts are Command/Ctrl-Z, Shift-Command/Ctrl-Z, Command/Ctrl-D, Command/Ctrl-S, Delete, and Escape. Text fields retain native editing shortcuts.

New scenes have a rectangular flat foundation with ground material, width, and depth controls. Existing terrain, constructed architecture, paths, surrounds, and attached fixtures remain visible and locked. Existing lights retain their setup. Newly placed light-bearing scenery inherits its authored lamp preset. Scenes support three environmental lights; placing another reports the limit without changing the composition. Choose an existing lighting rig and look preset in the scene inspector.

## Save and recover

Save writes an authored scene document. Save As creates a separate draft and never replaces an existing filename. New scenes and copies are drafts by default. **Edit Live** opens the actual room override; its persistent banner identifies that saving changes the scenery used by the game. Live changes can also move or remove existing prop collision footprints, so review traversal after editing a blocking prop. New decorations and duplicates have no blocking footprint.

Unsaved edits are stored as local recovery in this browser. Reloading offers Restore recovery or Dismiss. Recovery is separate from project files and game saves. Failed writes leave pending edits available. If an agent changes the scene file, saving rejects the stale revision; reload the file or use Save As. Changed base scene definitions or an asset pin require restarting and reviewing the composition before saving.

## Agent integration

Small versioned JSON files live under `authoring/scenes`. The schema and resolver are in [scene-document](../src/content/scene-document.ts). Agents can edit these files directly. Use stable object IDs, catalog asset IDs, and clip IDs; preserve unsupported versions or malformed files rather than resetting them.

Existing-room documents contain transform/deletion overrides plus added objects, with locked context supplied by the base room. The two live documents are imported by the game. Other documents remain authoring drafts until an agent adds the room's gameplay definitions and integrates its resolved visuals. Hero reference coordinates are editor data, not a player spawn or checkpoint.

The editor does not import source-library artwork, create textures, author terrain or architecture, define collisions, place encounters, connect rooms, or provide walking gameplay. Asset preparation and publication remain in the [asset workflow](assets.md).

## Verification

Run `npm test -- tests/scene-editor.test.ts` for document/history and filesystem conflict protection. `npm run scene:editor:check` exercises actual browser placement, inspector controls, undo/redo, saves, recovery, external-file conflicts, locked fixtures, and rendering resource lifetime. Full regular gates and affected Game/Dev builds remain required for handoff; existing-room renderer changes also use the scene checks described in [Contributing](../CONTRIBUTING.md#verification).
