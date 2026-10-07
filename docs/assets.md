# Asset ownership and verification

The shared source authority is `~/Documents/Asset Library/2d Assets/Lantern Knight`, backed up in iCloud. `ASSET_LIBRARY_ROOT` overrides the library location. Original archives and current project originals remain unchanged. The compact source index records archive/loose-file identities and paths as hints; [automatic recovery](source-recovery.md) handles reorganization without accepting different bytes.

Code, authoring recipes, the pack pin and small controlled fixtures belong in Git. Raw collections, expanded catalogs, atlases, registration arrays, captures and logs remain outside the checkout. The two original hero reference images are explicit repository exceptions; their bytes and the canonical Clean INK prompt are preserved.

## Preparation and publication

`assets:prepare` reads only selected members from verified source archives, creates derivatives in a reserved external workspace, and verifies source fidelity, corrected walk drawings, alpha-aware atlas packing, registrations and generated freshness. It retains the working Game and developer catalogs. The fixed-view studies remain provisional; delivery changes do not grant production-art approval.

Python 3 with OpenCV 5.0.0 and NumPy 2.0.2 is required only for preparing walk fields. Normal builds require Node and the pinned prepared pack.

`assets:publish` runs preparation, creates a deterministic shared tar.gz, publishes a content-identified asset release, verifies its public byte size and SHA-256, then atomically changes `assets/lock.json`. Existing published revisions are immutable. A failed preparation/upload/download or a recipe change during publication leaves the previous pin intact. Release files must remain below 2 GiB.

The pack contains selected current runtime pages/manifests, lighting/surface companions, walk data, coverage data and validation receipts. It excludes source archives, staged source images, historical generations and diagnostics. Game and Dev still ship their own catalog selections.

## Consumption

`assets:ensure` validates the pinned recipe and complete file inventory. Missing or corrupt packs are downloaded by their exact revision and verified before extraction. Unsafe paths, links, duplicate/case-colliding entries, oversized payloads and wrong hashes are rejected. Valid local copies work offline.

Normal commands hold a process lease across tests, builds or the development server. Vite reads the prepared public directory from the external cache. Browser and Node consumers share typed registration parsing; source-free checks validate contracts, pixels' stored hashes, quality, bindings, coverage, geometry and companion registration. They do not claim to verify original bytes unavailable to CI.

## Cache and retention

The cache is `~/Library/Caches/LanternKnight` on macOS, the XDG cache directory on Linux, or Local AppData on Windows. `LANTERN_CACHE_ROOT` can select another external cache. Its total budget is 4 GiB. Reservations include downloads, extracted assets, preparation intermediates and diagnostics. Old unused entries are evicted; active files are protected. Operations fail clearly when protected data and necessary working space cannot fit. Compressed downloads and transient files are removed after use.

Published deletion is explicit through `assets:clean`. It first resolves current/local, remote-main, open-PR and supported-release pins, and refuses deletion if reference inspection fails. It never deletes the shared source library. Initially no game releases are supported; maintain the short supported-tag list when releases enter or leave support.

Successful checks use summaries. Failures or explicit capture requests retain bounded external diagnostics. Hosted failure artifacts expire after three days. Do not commit output to preserve a review history.
