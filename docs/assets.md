# Assets

## Ownership

Originals live in the iCloud-backed Asset Library under `Lantern Knight`, organized by subject: Characters, Environments, Props, Items, Effects, Title and Loading, and Guides. Useful exports are browsable beside their Sources; original package bytes and internal paths remain unchanged. Preserve archives, unique revisions, canonical hero references, Clean INK prompts and provenance. The source index records hashes as identity and paths as hints; [source recovery](source-recovery.md) handles moves. Ordinary code/build/CI work does not scan the library.

Git contains code, small recipes and the shared pin. Native source collections, prepared pages/catalogs, captures and logs remain outside Git. The external disk cache defaults to 16 GiB. Set `LANTERN_CACHE_BUDGET_GIB` to change it; active readers remain protected. This disk budget is separate from GPU residency.

## Local preparation review

Use `npm run assets:prepare` to reconcile and prepare the complete current library with native lossless pages, previews and resolution variants. `npm run assets:prepare -- --gpu` additionally cooks GPU-compressed opaque images; it reuses unchanged derivatives. This expensive stage does not block ordinary library import or decide asset eligibility. `-- --ids <asset-id>...` selects an owner; delivery finalization checks its dependencies. One executor handles full and scoped steps. Successful steps cache immutable outputs and source identities; changed inputs or corrupt outputs rebuild the affected step. Freshness/fidelity belong to preparation, with selected original bytes reverified on reuse.

Preparation uses Node and Python for specific image/walk-field tools. For authoring, create `.venv`, install OpenCV 5.0.0, NumPy 2.0.2, Pillow and Ruff 0.16.10, and use that environment. Ordinary tests/builds do not need it. `--proof` explicitly requests full preparation and a ground contact proof. Preparation never regenerates original artwork.

Development prefers its local layer, otherwise the shared pin. Builds and CI use the pin; `npm run build -- --local` and `npm run assets:check -- --local` deliberately inspect a local preparation. No candidate/preview/publication-state protocol is needed to iterate.

## Consumption

Consumers acquire an explicit workspace with its root, identity and release operation. Legacy preparation/test subprocesses receive paths at their process boundary. Missing or corrupt pinned downloads are verified before installation; valid cached assets work offline. Safe extraction, inventory checks, exact bytes and active leases remain required.

Builds derive a selected inventory including manifests, pages, registration, lighting/surface companions and loading media. They validate and copy those files once. Vite does not copy the entire public directory before pruning it. Game artifacts select the assets required by resolved Game content, including its initial effects and actors. Published runtime delivery includes those dependencies and the base runtime resources. Content can reuse assets present in its acquired payload; a newly selected asset absent from the published runtime bundle requires refreshed delivery. Additional authoring resources form separate bundles: authoring requires runtime, while Game/CI can request runtime alone.

The shared version 3 pin identifies separate runtime and authoring bundles. Existing monolithic releases remain preserved.

Game content can reference any prepared library ID by its stable manifest path. There is no second promotion allowlist. Authoring catalog overlap is allowed only for an identical binding; a conflicting path still fails. Current combat defaults use Sword Finisher 03 and Blocked Contact Shear from the existing pin without regenerating or publishing original artwork.

## Preparation and publication

`npm run assets:publish` explicitly prepares/reuses current source-verified outputs, validates consuming runtime references, publishes immutable runtime/authoring bundles, verifies downloadable bytes and atomically changes the pin. Failure preserves the previous pin. It does not package the game, require capture galleries, or claim production-art approval. Publication needs an authenticated `gh` release writer and working download access.

Delivery reserves compression space through the same configurable cache budget. After validating the monolithic candidate identity, publication removes that redundant archive before creating the delivered bundles. Active readers remain protected; close unused previews if their leases prevent publication from fitting.

Publication is sharing prepared assets, separate from shipping a game. Original artwork generation/editing follows AGENTS and the art-direction skill. Inspect generated artwork when authoring it; the publisher does not turn aesthetic advice into release receipts.

## Runtime composition boundary

Scene layout, gameplay geometry, camera and lighting are runtime content. Preparation recipes own artwork-producing inputs and dependency order. Moving existing scenery does not bake or publish artwork. Changes to authored hero drawings, timing, registration or bake calibration require affected preparation; runtime timing overrides remain content. Source-free tests still verify the resulting current bindings.

The current TEST hero uses supplied native drawings, eight-direction running, four-direction idle/actions, guarded treatment and rigid-sword protection. Source handoff timing and raster bytes remain preserved; gameplay uses authored 60 Hz holds. The owner-supplied Last Ferry loading video is copied unchanged and played silently during loading. These choices do not establish final art quality.

## Cache and retention

`LANTERN_CACHE_ROOT` can choose an external disposable location; `ASSET_LIBRARY_ROOT` selects the parent source library. Unused local cache entries are evicted within the budget. `npm run assets:clean` cleans local disposable data only, preserving the current pin and active readers. Published releases and source originals are never deleted by cleanup.

`npm run assets:inspect -- <asset-id>` prints bounded metadata. Explicit diagnostics retain output externally; normal checks do not keep passing-evidence receipts.

## Preparation ownership

TypeScript recipe steps are callable operations registered in `tools/assets/operations.ts`. They receive an explicit preparation context for source access, paths, atomic output recording and incremental byte accounting. Compiler writes use the same writer. Python subprocesses receive the translated context at their launch boundary; ordinary builds never invoke preparation.

Publication uses version 3 split runtime/authoring bundles. Fresh-checkout CI verifies acquisition through the shared pin without source-library access. Source artwork and published archives remain preserved.

## Library authoring coverage

The authoring catalog includes delivered townsfolk, wildlife, searchable containers, portal clips and hero interactions. `assets/library-packs.json` supplies adapters for their original metadata contracts; `assets/library-artwork.json` supplies registration for intact paintings and loose artwork. Discovery also covers additional loose files and archive members. These recipes do not restrict library eligibility. Source identities and locations remain in the source indices. No file discovery runs in Game, builds or CI.

Use `npm run assets:prepare -- --ids library-all` to refresh this catalog locally. Intact scene paintings are placeable ground panels where registered, with editable provisional world scale. Supplied resolution variants belong in the prepared catalog at their original dimensions. Preview media remains available source material; video scene objects require a media renderer. Existing Game bindings and the published pin do not change.

The authoring catalog includes supplied combat animation kits with their original millisecond timelines, contact markers, fixed pivots and transparent terminal holds. Enemy and hero timing variants remain separate clips. Packs without a delivered world density use the provisional 256 pixels per unit registration; they carry no gameplay collision or damage authority. Loose title artwork and waypoint source sheets are available as reference assets.

## Library coverage policy

The prepared authoring library must represent every distinct supplied asset and version in the current external library. Resolution, concept/study status, review labels, folder names and current Game selection are not eligibility filters. Archives, duplicate exports and provenance may map to the same logical asset; they do not require duplicate scene objects. Keep provenance and distinguish original drawings from upscaled versions without hiding either.

Native originals retain their own bindings even when Game already uses a processed version of the same source. A cropped or resized Game derivative cannot stand in for its master. Identical prepared bytes may share storage.

Preserve supplied image dimensions, pixels, alpha, animation frames and timing. Complete Scenes includes its 6144×4096 paintings. Scale registration with resolution so a higher-resolution variant does not become a larger world object. Atlas packing size is a preparation setting, not an eligibility limit on supplied images. Rendering checks the actual GPU texture limit and reports unsupported use.

Reconcile explicit preparations against the current external library. Recover moves by content identity, remove entries whose sources are absent, and report unregistered assets, unsupported formats and unresolved registration as coverage gaps. Do not classify an unknown archive as rejected, superseded, deferred or source-only from its name. New import adapters must close these gaps; a successful preparation of the registered subset is not proof of complete library coverage.

Cache budgets limit residency and preparation working space, not asset eligibility. Game builds may select the assets they use, and publication remains explicit; those delivery choices must not restrict authoring-library availability. Reference-only presentation records a current integration limitation, not permanent exclusion from scene use.

## Images for game use

The original remains authoritative. Preparation retains a full-resolution lossless PNG page and generates a small preview. Complete scene paintings are intact single images: their layout uses clamped UVs, preserves aspect ratio and compensates for ground foreshortening. They do not repeat unless the author explicitly chooses Repeat.

Game delivery adds full-composition approximately 2K, 4K and native variants for intact single-frame images. Actors and animation atlases retain native registration and dimensions. Alpha-sensitive images use lossless PNG delivery, preserving soft edges and additive effects. Explicit GPU cooking gives opaque images with GPU-compatible block dimensions the standard high-quality UASTC level 2 preset, with Zstandard level 6 for lossless storage compression. Decoded RGB error and SSIM are recorded as diagnostics; they are not universal visual-approval thresholds. Unexpected changes to an opaque alpha channel fall back to PNG. Compatible RGB and RGBA PNGs retain their original encoded bytes; adding an opaque alpha channel is unnecessary. Color-profile, orientation and format conversions still run when required. Only resized variants and previews need PNG encoding. Originals remain unchanged.

GPU cooking requires Khronos KTX-Software 4.4.2 (`ktx` on PATH or `LANTERN_KTX`). The runtime retains native detail when it fits the actual GPU limit; mipmaps handle minification. Smaller full-composition variants support constrained GPUs. Screen dimensions alone do not establish projected image coverage during camera pan or zoom, so they do not silently downscale assets. It follows the UASTC target preference of ASTC, then BC7; other devices use PNG. Source-quality inspection uses native lossless images. Use representative scene, sprite, effect and UI samples to review a codec profile in the renderer before applying it broadly. Loading and disposal follow asset leases; the whole library is never loaded into GPU memory at once. Mipmaps are sampling levels for reduced display size, not repeating texture behavior.

## Coverage and limitations

Explicit preparation scans loose files and ZIP members by content identity. Duplicate copies share an image binding; distinct resolution versions remain distinct. Moves update locations; a source absent from the active library cannot be recovered from unrelated storage. The finalized catalog removes stale library outputs. Interrupted candidates resume through a checkout-local checkpoint; every reused producer, source identity and derivative hash is revalidated before activation. Preparation verifies image catalog coverage, native media hashes and the source snapshot before activating its local layer.

Metadata adapters interpret animation timing, pivots and slices. Unrecognized or incomplete animation contracts are listed in the prepared inventory with their actual failure, while the supplied images and native media remain available. The editor's Source inventory & media panel exposes coverage counts, source associations, media previews/downloads and these limitations. It does not invent missing timing or convert source sheets into guessed animation. SVG originals and fonts remain downloadable; SVGs can be previewed as images. Video/audio are available media, not yet playable scene objects; GLB/Blend files require a model importer.

Disk limits protect residency instead of deciding eligibility. Shared content is hardlinked and counted once, free disk space is checked, and active leases cannot be evicted. `LANTERN_PREPARE_BUDGET` overrides the preparation workspace target in bytes (default 70% of the cache limit). Large authoring releases split into approximately 1 GiB payload groups, independently acquired by the existing version 3 bundle pin. Publication remains explicit and keeps the prior pin until verification succeeds.

Local preparation, Game content selection and published delivery are distinct. A complete local authoring catalog does not change the shared pin or automatically add every asset to a Game build. Game content can select any prepared library ID by its stable manifest path; it no longer needs a second curated promotion list. Browser/device verification is required for actual renderer and codec compatibility.

## Preparation guidance

Import coverage and game cooking are separate responsibilities. The complete catalog retains every supplied asset/version. Build selection follows actual content dependencies, and does not remove unused assets from the authoring catalog. Preserve frame registration and animation timing when trimming/packing sprites; complete scene paintings stay standalone and never inherit a sprite-atlas page limit. Existing native sheets can be retained as delivered. Further sprite packing should reuse the compiler and prove pixel/registration parity rather than inventing frame fitting.

Use conservative content-based format profiles, and review a representative batch before expensive full-library GPU cooking. Lossless storage compression levels change preparation time and bytes on disk, not decoded image quality. Cache image derivatives by source hash and explicit encoding settings; edits to runtime loading or reporting must not force pixel encoding again. Ordinary builds consume prepared artifacts and never cook source artwork implicitly.

Transparency classification reads only alpha values; it does not calculate full-image sharpness, entropy or dominant colors. Preparation carries verified file hashes between stages, hashes shared inodes once per checksum pass, and batches metadata reads. Reused producers link existing immutable bytes and do not repeat cache growth reservations; new outputs and the final layer still receive full budget accounting. Resume copies only missing completed step caches.

The atomic writer records expected output hashes. Before caching a producer, the executor hashes its actual files and compares them with those expectations. Native library import and delivery perform source, manifest and coverage checks during generation; this byte verification replaces a second full regeneration of those stages. Corrupt writes fail before activation. Encoding fingerprints track producers, encoding inputs and settings; filesystem orchestration remains a workflow input without invalidating every pixel producer.

Primary guidance: [Khronos KTX Artist Guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md), [KTX encoder presets](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html), [NVIDIA asset compression workflow](https://developer.nvidia.com/astc-texture-compression-for-game-assets), and [Unreal derived data caching](https://dev.epicgames.com/documentation/unreal-engine/using-derived-data-cache-in-unreal-engine). These inform the workflow; project-specific quality requirements still need actual scene/device validation.
