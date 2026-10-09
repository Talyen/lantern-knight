# Assets

## Ownership

Originals live in the iCloud-backed Asset Library under `2d Assets/Lantern Knight`. Preserve archives, unique revisions, canonical hero references, Clean INK prompts and provenance. The source index records hashes as identity and paths as hints; [source recovery](source-recovery.md) handles moves. Ordinary code/build/CI work does not scan the library.

Git contains code, small recipes and the shared pin. Native source collections, prepared pages/catalogs, captures and logs remain outside Git. The external asset cache retains a 4 GiB budget and leases protecting active readers.

## Local preparation review

Use `npm run assets:prepare -- --ids <asset-id>...` to prepare selected owners and their dependencies. One executor handles full and scoped steps. Successful steps cache immutable outputs and source identities; changed inputs or corrupt outputs rebuild the affected step. Freshness/fidelity belong to preparation, with selected original bytes reverified on reuse.

Preparation uses Node and Python for specific image/walk-field tools. For authoring, create `.venv`, install OpenCV 5.0.0, NumPy 2.0.2 and Ruff 0.16.10, and use that environment. Ordinary tests/builds do not need it. `--proof` explicitly requests full preparation and a ground contact proof. Preparation never regenerates original artwork.

Development prefers its local layer, otherwise the shared pin. Builds and CI use the pin; `npm run build -- --local` and `npm run assets:check -- --local` deliberately inspect a local preparation. No candidate/preview/publication-state protocol is needed to iterate.

## Consumption

Consumers acquire an explicit workspace with its root, identity and release operation. Legacy preparation/test subprocesses receive paths at their process boundary. Missing or corrupt pinned downloads are verified before installation; valid cached assets work offline. Safe extraction, inventory checks, exact bytes and active leases remain required.

Builds derive a selected inventory including manifests, pages, registration, lighting/surface companions and loading media. They validate and copy those files once. Vite does not copy the entire public directory before pruning it. Runtime and additional authoring resources are separate bundles: authoring requires runtime, while Game/CI can request runtime alone.

The currently published monolithic pin remains usable through the transition. The new two-bundle format becomes active at the next explicit publication. Existing releases are not rewritten or deleted by implementation.

## Preparation and publication

`npm run assets:publish` explicitly prepares/reuses current source-verified outputs, validates consuming runtime references, publishes immutable runtime/authoring bundles, verifies downloadable bytes and atomically changes the pin. Failure preserves the previous pin. It does not package the game, require capture galleries, or claim production-art approval. Publication needs an authenticated `gh` release writer and working download access.

Publication is sharing prepared assets, separate from shipping a game. Original artwork generation/editing follows AGENTS and the art-direction skill. Inspect generated artwork when authoring it; the publisher does not turn aesthetic advice into release receipts.

## Runtime composition boundary

Scene layout, gameplay geometry, camera and lighting are runtime content. Preparation recipes own artwork-producing inputs and dependency order. Moving existing scenery does not bake or publish artwork. Hero timing/registration and bake calibration changes require affected preparation; source-free tests still verify the resulting current bindings.

The current TEST hero uses supplied native drawings, eight-direction running, four-direction idle/actions, guarded treatment and rigid-sword protection. Source handoff timing and raster bytes remain preserved; gameplay uses authored 60 Hz holds. The owner-supplied Last Ferry loading video is copied unchanged and played silently during loading. These choices do not establish final art quality.

## Cache and retention

`LANTERN_CACHE_ROOT` can choose an external disposable location; `ASSET_LIBRARY_ROOT` selects the parent source library. Unused local cache entries are evicted within the budget. `npm run assets:clean` cleans local disposable data only, preserving the current pin and active readers. Published releases and source originals are never deleted by cleanup.

`npm run assets:inspect -- <asset-id>` prints bounded metadata. Explicit diagnostics retain output externally; normal checks do not keep passing-evidence receipts.
