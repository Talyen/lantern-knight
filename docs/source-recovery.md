# Source recovery

Lantern treats source paths as hints and source hashes as identities. External imports and the asset source reader recover moved or renamed originals automatically when they need them. There is no relink step or background service. Prepared assets do not need the external source library to remain mounted.

## Identity and lookup

`assets/sources.json` pins archive SHA-256 and byte size, plus the logical path, SHA-256 and byte size of each loose source and collection sidecar. Moving files, renaming archives (even their extensions), splitting packs among folders, or reorganizing loose files preserves those identities. Archive member names remain the authored logical paths; changing archive contents or source bytes is a new revision, not a relocation.

Lookup tries the expected path, then a previously verified cached location, then recursively searches the Asset Library. If necessary, it searches Documents. This includes finding the entire library after it is renamed or moved elsewhere within Documents. Size filters avoid hashing unrelated files. One recovery scan discovers locations for all registered identities it encounters. Identical copies are interchangeable; sorted traversal chooses a stable candidate. Files with a familiar name but different bytes are rejected.

Local location metadata is written atomically under Lantern's cache (`~/Library/Caches/LanternKnight` on macOS). OS file locks coordinate simultaneous processes and release on interruption. A shared source-reader worker reuses discovery and archive verification during a tooling operation; filesystem identity, size, modification time and change time invalidate that verification when a file changes. Cached locations are revalidated on use. A missing-then-restored source can recover on the next request.

Search does not follow symlinks or descend into Lantern's checkout/cache, hidden directories, `node_modules`, build outputs or release outputs. An inaccessible directory does not prevent searching other locations. A missing-source error names the logical source, expected hash and searched roots. Recovery never moves or edits originals, rewrites provenance, changes canonical artwork, or accepts a different revision.

## Configuration

`ASSET_LIBRARY_ROOT` selects the parent Asset Library folder, normally `~/Documents/Asset Library`, rather than the project's source folder; tools append the source index's `libraryDirectory`, currently `Lantern Knight`. `LANTERN_CACHE_ROOT` selects the external cache. Sources outside Documents can be found using `LANTERN_SOURCE_SEARCH_ROOTS`, a list of additional search roots separated by the platform path separator (`:` on macOS/Linux, `;` on Windows). These are configuration options for other machines; normal reorganization within this Mac's Documents folder requires no configuration.

Recovery fixtures run with `npm run test:assets`, using temporary files to cover relocation, wrong revisions, cache invalidation, interruptions and concurrent recovery. No test rearranges the source library.

## Source health and consolidation

Run an explicit source health check:

```sh
python3 -B tools/assets/library.py check
```

This verifies all pinned archive/loose-file identities and warms verified locations. Use `--fresh` for a temporary location cache. Normal builds and CI consume prepared assets without scanning the library.

Optional `pathHint` values locate originals within the library without changing logical IDs. Several loose-file identities can share one identical retained file. `archiveGroups` isolates selected hero packages that reuse member names; callers continue using `readLibrarySource(member, group)`. Archive bytes remain immutable even when the external filename changes.

The library groups characters, environments, props, items, effects and title/loading media by subject. Sources remain beside their assets; shared packages stay together. Original logical receipts remain readable through explicit path hints and the hash resolver.
