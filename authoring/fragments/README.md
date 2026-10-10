# Scene fragments

In the scene editor, Artwork → Arrangements opens the library for saving selected artwork here as small JSON recipes. A version 1 recipe contains a name and scene objects, including their transforms, attachments and light fixtures. Inserting a fragment creates independent copies with new object and fixture identities.

Saving a selection includes its attached descendants. An attachment whose support is outside the selection becomes an independent upright object at its resolved position; select the support as well to retain that relationship.

Recipes do not store gameplay placements, paths or room geometry; those remain in the scene document. Generated thumbnails and captures stay outside Git.

See the [scene editor](../../docs/developer-tools.md#scene-editor) for creation and reuse.
