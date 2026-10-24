# Source recovery

Lantern Knight owns its source inputs in `asset-data/sources/`. Source paths are hints and SHA-256 hashes identify exact bytes. Readers may recover renamed or moved originals inside the owned source root; they never search Documents, the former Asset Library, or environment-configured external roots.

## Identity and lookup

`assets/sources.json` and its supplements record archive and loose-file hashes, byte sizes and logical paths. Lookup tries the expected owned path, then a previously verified location inside the owned root, then searches that root. An external cached location is rejected even when its bytes match. Missing inputs fail with the logical identity and searched root; existing accepted prepared assets remain usable.

Moving or renaming an original preserves its content identity. Replacing bytes is a new revision and requires an explicit recipe/import decision. Archive member names remain authored logical paths. Source resolution never edits originals or accepts a different revision. It rejects symlinks and verifies selected source bytes. Local disposable location metadata does not establish ownership.

## Configuration

Project inputs have a fixed checkout-relative root: `asset-data/sources/`. `ASSET_LIBRARY_ROOT`, `LANTERN_SOUND_LIBRARY` and `LANTERN_SOURCE_SEARCH_ROOTS` cannot redirect them. `LANTERN_CACHE_ROOT` selects disposable preparation storage only. New inputs enter through the explicit import command in [Assets](assets.md#choose-a-workflow).

## Importer metadata

Preserve `.lantern/identities.json` and `.lantern/metadata/` inside the owned Lantern Knight source folder. These retain logical asset IDs across moves and replacements, original metadata bytes, archive member tables and provenance. They are durable Git inputs, not disposable cache data.

Preparation prefers hash-identical loose artwork inside the owned root, then retained metadata, then verified original ZIP members. Original archives remain available for reprocessing and recovery. Reconciliation considers only owned source membership; retained metadata cannot restore a deleted archive. Ground interaction remains bound to the reviewed painting hash, frame and dimensions; follow [saved ground profile restoration](developer-tools.md#saved-ground-profiles) when artwork changes.

## Source health and consolidation

`python3 -B tools/assets/library.py check` verifies the owned source identities. `--fresh` uses temporary location metadata. The optional consolidation command operates only on owned originals; review its dry-run manifest before explicitly applying it. Ordinary builds and CI consume prepared objects without source scans.

`npm run test:assets -- tests/assets/source-recovery.test.ts` runs temporary fixtures for content identity, moves, wrong revisions, confinement, interruption and concurrent readers. No fixture rearranges real source artwork. Historical recovery fixtures can supply explicit temporary search roots; production callers remain confined to owned inputs.
