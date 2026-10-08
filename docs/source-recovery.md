# Automatic source recovery

Lantern treats source paths as hints and source hashes as identities. External imports and the asset source reader recover moved or renamed originals automatically when they need them. There is no relink step or background service. Prepared assets do not need the external source library to remain mounted.

`assets/sources.json` pins archive SHA-256 and byte size, plus the logical path, SHA-256 and byte size of each loose source and collection sidecar. Moving files, renaming archives (even their extensions), splitting packs among folders, or reorganizing loose files preserves those identities. Archive member names remain the authored logical paths; changing archive contents or source bytes is a new revision, not a relocation.

Lookup tries the expected path, then a previously verified cached location, then recursively searches the Asset Library. If necessary, it searches Documents. This includes finding the entire library after it is renamed or moved elsewhere within Documents. Size filters avoid hashing unrelated files. One recovery scan discovers locations for all registered identities it encounters. Identical copies are interchangeable; sorted traversal chooses a stable candidate. Files with a familiar name but different bytes are rejected.

Local location metadata is written atomically under Lantern's cache (`~/Library/Caches/LanternKnight` on macOS). OS file locks coordinate simultaneous processes and release on interruption. A shared source-reader worker reuses discovery and archive verification during a tooling operation; filesystem identity, size, modification time and change time invalidate that verification when a file changes. Cached locations are revalidated on use. A missing-then-restored source can recover on the next request.

Search does not follow symlinks or descend into Lantern's checkout/cache, hidden directories, `node_modules`, build outputs or release outputs. An inaccessible directory does not prevent searching other locations. A missing-source error names the logical source, expected hash and searched roots. Recovery never moves or edits originals, rewrites provenance, changes canonical artwork, or accepts a different revision.

`ASSET_LIBRARY_ROOT` selects the parent Asset Library folder, normally `~/Documents/Asset Library`, rather than the project's source folder; tools append the source index's `libraryDirectory`, currently `2d Assets/Lantern Knight`. `LANTERN_CACHE_ROOT` selects the external cache. Sources outside Documents can be found using `LANTERN_SOURCE_SEARCH_ROOTS`, a list of additional search roots separated by the platform path separator (`:` on macOS/Linux, `;` on Windows). These are configuration options for other machines; normal reorganization within this Mac's Documents folder requires no configuration.

The recovery fixture suite runs with `npm test`. It exercises normal readers, import preflight, nested and whole-library moves, renamed archives and loose files, stale or interrupted cache metadata, duplicate and wrong-revision files, deleted/restored sources, inaccessible directories, symlinks, extra roots, moves during opening and concurrent recovery. All filesystem rearrangements occur in temporary fixtures.

## Source health and consolidation

`npm run assets:sources:check` verifies all pinned archive and loose-file identities and warms verified locations. `-- --numbered-only --fresh` uses a temporary location cache and accepts candidates only inside the numbered folders; neither legacy paths nor cached files elsewhere can satisfy it. Normal builds and CI still consume the prepared pack without scanning the library.

Optional `pathHint` values locate originals within the library without changing logical IDs. Several loose-file identities can share one identical retained file. `archiveGroups` isolates selected hero packages that reuse member names; callers continue using `readLibrarySource(member, group)`. Archive bytes remain immutable even when the external filename changes.

`npm run assets:dedupe` produces an external dry-run manifest and performs no library changes. `-- --manifest /absolute/external/plan.json` chooses its location. Apply the reviewed inventory with `-- --apply --manifest /absolute/external/plan.json`. The command refuses changed inventories or modified manifests, relocates unique legacy sources to their numbered categories, verifies all registered identities in those categories, and rehashes each retained/redundant pair immediately before deletion. It preserves one complete copy of every distinct file content, all ZIP members, canonical artwork and unique revisions. It does not clean published packs.

The numbered layout retains environment Project Sources under category 03, walk studies under the original-view hero studies, and foundation sources under the guides. Original logical receipts remain readable through the hash resolver even when identical drawings have been consolidated across studies.
