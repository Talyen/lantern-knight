# Scene editor

Run `npm run dev` and open `/editor.html`. Start a flat draft, copy either room, or edit its live document. Search/drag artwork, select placements, adjust transforms, duplicate/delete, and use undo/redo. Palette and treatment advice does not block valid experiments.

Ground, camera framing and playable bounds are editable; the current authored document also contains surrounds, paths, supports and scene geometry. Edit those fields directly for changes not exposed by the inspector. Scene documents are version 5; old drafts require manual adaptation rather than runtime migration.

Save updates the current document. Save As creates a draft copy. Recovery preserves unsaved work across reloads. Unreadable/older recovery remains stored and can be downloaded as JSON before manual adaptation or explicit dismissal. If the file changed externally, preserve the draft, reload or save a separate copy; writes compare revisions and use atomic replacement. Editing never writes game checkpoints.

Missing assets/clips, malformed numbers, duplicate IDs, cyclic attachments, obstructed required entries and unsupported light capacity remain errors. Design advice covers palette, composition, scale, mirroring and experimental treatment.

`npm run test:browser -- editor` verifies the authoring flow. [Development](development.md) and [verification](verification.md) own the process. Original artwork follows [assets](assets.md).
