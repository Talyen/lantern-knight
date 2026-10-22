# Assets

## Ownership

Originals live in the iCloud-backed Asset Library under `Lantern Knight`, organized by subject: Characters, Environments, Props, Items, Effects, Title and Loading, and Guides. Useful exports are browsable beside their Sources; original package bytes and internal paths remain unchanged. Preserve archives, unique revisions, canonical hero references, Clean INK prompts and provenance. The source index records hashes as identity and paths as hints; [source recovery](source-recovery.md) handles moves. Ordinary code/build/CI work does not scan the library.

Git contains code, small recipes and the shared pin. Native source collections, prepared pages/catalogs, captures and logs remain outside Git. The external disk cache defaults to 32 GiB. Set `LANTERN_CACHE_BUDGET_GIB` to change it; active readers remain protected. This disk budget is separate from GPU residency.

## Choose a workflow

| Task                                                                     | Action                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Develop code using accepted artwork                                      | `npm run dev`; pinned assets download as needed.                                                                       |
| Move existing artwork or edit scene geometry                             | Use the [scene editor](developer-tools.md#scene-editor); no asset preparation is needed.                               |
| Refresh known artwork inputs                                             | `npm run assets:prepare -- --ids <asset-id>...`; selected producers and their finalizers refresh locally.              |
| Reconcile additions, replacements, moves or deletions across the library | `npm run assets:prepare`; review [coverage gaps](#library-coverage-policy).                                            |
| Build a Game prototype with local artwork                                | `npm run build -- --local` or `npm run package -- --local`.                                                            |
| Share prepared artwork                                                   | Use [assets:publish or assets:publish-files](#preparation-and-publication) when task-scoped assets are ready to share. |

Local preparation does not change the shared pin. Saving a scene does not register it in Game; follow [Game content registration](architecture.md#add-an-area-or-enemy).

## Local preparation review

Use `npm run assets:prepare -- --ids <asset-id>...` for a scoped refresh, or omit IDs to reconcile the complete external library. Dependencies and affected finalizers are selected automatically. A missing verified base falls back to full preparation. Failed preparation preserves the active layer and shared pin.

Preparation needs the source library, [KTX-Software](#images-for-game-use) and a checkout-local `.venv` containing OpenCV 5.0.0, NumPy 2.0.2, Pillow 13.0.0 and Ruff 0.16.10. Activate it so `python3` subprocesses use that environment. Foreground-selection models have [separate setup](developer-tools.md#local-foreground-selection-setup). Ordinary code, builds and packaging need none of these dependencies.

Development prefers the calling checkout's local preparation, otherwise the shared pin. Builds use the pin; choose `npm run build -- --local` or `npm run assets:check -- --local` deliberately. `--proof` requests full preparation and a ground contact proof; `--gpu` remains accepted for existing scripts. Preparation never regenerates original artwork. Producer graphs, source verification and incremental reuse are documented in [pipeline internals](asset-pipeline.md#preparation).

## Consumption

Ordinary code, builds and CI consume verified pinned assets without source-library access. Valid cached assets work offline. Asset commands manage workspace leases and cache admission automatically; do not manually remove active cache entries.

### Game and build selection

Game selects assets referenced by resolved content, including existing authoring assets newly used in Game. Moving or referencing artwork already in the pin requires no publication. Development serves the same Game selection; authoring retains the full catalog.

### On-demand authoring

Browser previews acquire artwork as requested. Use `npm run dev -- --eager` for a complete authoring workspace before going offline. Live authoring desktop development acquires its complete workspace.

### Shared pin and catalog bindings

`assets/lock.json` identifies immutable prepared delivery; catalogs and payloads stay outside Git. Game references stable manifest paths without a second promotion allowlist. Delivery versions, range verification, containers and cancellation contracts belong to [pipeline internals](asset-pipeline.md#consumption).

## Preparation and publication

Agents may publish assets within their assigned task without separate approval. Respect explicit user restrictions and preserve unrelated artwork and pins. Inspect changed artwork, verify original sources through preparation, then run `npm run assets:publish`. It verifies consuming references and downloadable bytes before atomically updating the pin; failure preserves the previous pin. Publication requires an authenticated `gh` release writer and working download access.

Use `npm run assets:publish-files` only to upgrade an accepted version 3 delivery pin to version 4 without changing artwork or source provenance. New and changed artwork uses `assets:publish`.

Publication shares prepared assets; shipping the game follows [delivery](release.md). Container reuse, upload verification and cache accounting belong to [pipeline internals](asset-pipeline.md#publication).

## Runtime composition boundary

Scene layout, gameplay geometry, camera and lighting are runtime content. Preparation recipes own artwork-producing inputs and dependency order. Moving existing scenery does not bake or publish artwork. Changes to authored hero drawings, timing, registration or bake calibration require affected preparation; runtime timing overrides remain content. Source-free tests still verify the resulting current bindings.

The current TEST hero uses supplied native drawings, eight-direction running and idle, four-direction actions, guarded treatment and rigid-sword protection. [Hero animation bindings](#hero-animation-bindings) records the delivered clips and current Game selection. Source handoff timing and raster bytes remain preserved; gameplay uses authored 60 Hz holds. The owner-supplied Last Ferry loading video is copied unchanged and played silently during loading. These choices do not establish final art quality.

`authoring/hero-scale.json` owns per-clip and per-drawing registration scale. `authoring/hero-motion.json` owns native-space motion landmarks and is hashed by animation registration. Scale-only preparation changes leave that motion identity intact; publishing newly prepared artwork remains a separate step.

Calibrate hero size against the current idle's head and upper-torso proportions at equal world scale. Use the matching diagonal idle or both neighboring idles for cardinal runs, then inspect every drawing, loop seam and action join. Silhouette height and width include pose compression, weapons and coat tails; they cannot determine anatomical scale. Prefer uniform clip corrections about the native pivot, reserving drawing overrides for confirmed size outliers. Inspect registration drift separately and preserve deliberate bob, lean and airborne poses.

## Character scale calibration

Hero and library preparation share `tools/assets/actor-scale.ts`. A correction multiplies displayed size by dividing the supplied density; source pixels, native canvas, foot pivot and timing stay intact. Gameplay actor size remains independent, including the Warden's larger presentation scale.

`authoring/actor-scale.json` holds library character reviews. Each entry names a neutral size reference, explains the review, covers every delivered clip/facing in `clips`, and optionally supplies `frames` overrides. Frame keys identify the original pixel hash, atlas rectangle and native registration, rather than the generated frame ID that changes with calibration. Corrections compose with supplied density adjustments. Reused drawings must receive the same effective correction across action joins. The source identity invalidates a review when drawings, their order, delivered directions or native registration change. Library preparation requires review coverage for character assets from the registered enemy packs; other characters can use the same recipe.

Run `npm run assets:scale-review -- --output /external/character-review` in the authoring Python environment. It reconciles sources, verifies selected original bytes and exports an HTML player, all-drawing contact sheets, supplied/reviewed overviews and a source-bound recipe draft outside Git. `--asset library-sk03` limits inspection; repeated `--asset` options select several enemies. `--plan /external/normalized-plan.json` reuses an explicit normalized source snapshot while still verifying its drawing bytes; ordinary review should use fresh discovery. The draft is a starting point, not visual approval. Compare head/torso proportions and rigid props at equal world scale; use the player's reference overlay, frame stepping and action-join playback. Alpha bounds frame the sheets only and never determine corrections. Keep all intentional squash, stretch, lean, flight, wing folding and death poses.

After editing the recipe, rerun review and use `npm run assets:prepare -- --ids library-sk03` (or the affected library asset ID). Review the prepared result in Dev Preview's Animation browser before task-scoped asset publication. New source drawings need a new review; do not copy an old source identity merely to pass preparation. Keep source sheets with no authoritative timeline as still references.

The current review covers 23 timed enemy kits, plus the Clockwork Beetle's six still source sheets and one Shroud Wisp reference. Candlebone Oracle's added facings supplied PPU values relative to a provisional DR=100 convention. Their six move/cast bindings use a 100/256 correction to inherit the original DR world density; the original DR drawings, hover, reactions and defeat retain their supplied size. Other reviewed kits retain their supplied registration and intentional pose changes.

## Cache and retention

`LANTERN_CACHE_ROOT` can choose an external disposable location; `ASSET_LIBRARY_ROOT` selects the parent source library. Temporary download reservations are released after installation. Unused local cache entries are evicted within the budget. `npm run assets:clean` cleans local disposable data only, preserving the current pin and active readers. Published releases and source originals are never deleted by cleanup.

`npm run assets:inspect -- <asset-id>` prints bounded metadata from the shared pin. Use `npm run assets:inspect -- --local <asset-id>` to inspect checkout-local preparation, falling back to the pin when none exists. Inspection requests only the authoring catalog and the selected manifest, verifying those bytes before reading them. It acquires no image payload. Full `assets:check` retains complete workspace validation. CI uses `assets:check -- --built` for the active Game catalog in the verified web artifact, plus `test:assets -- --built` for current Game compatibility and import/recovery fixtures. It does not materialize or audit unused library artwork; the commands without `--built` remain explicit full-artwork investigations. Explicit diagnostics retain output externally; normal checks do not keep passing-evidence receipts.

## Library authoring coverage

The authoring catalog includes delivered townsfolk, wildlife, searchable containers, portal clips and hero interactions. `assets/library-packs.json` supplies adapters for their original metadata contracts; `assets/library-artwork.json` supplies registration for intact paintings and loose artwork. Discovery also covers additional loose files and archive members. These recipes do not restrict library eligibility. `tools/assets/library_import.py` owns ordered metadata alias policies for registration and timing; adapters select those policies without changing source precedence. Source identities and locations remain in the source indices. No file discovery runs in Game, builds or CI.

The authored import-adapter recipe `assets/library-packs.json` has a 128 KiB repository allowance. Generated library catalogs, source indices and prepared packs remain external; other JSON inputs retain their existing limits.

Use `npm run assets:prepare -- --ids library-all` to refresh this catalog locally. Intact scene paintings are placeable ground panels where registered, with editable provisional world scale. Supplied resolution variants belong in the prepared catalog at their original dimensions. Preview media remains available source material; video scene objects require a media renderer. Existing Game bindings and the published pin do not change.

The authoring catalog includes supplied combat animation kits with their original millisecond timelines, contact markers, fixed pivots and transparent terminal holds. Enemy and hero timing variants remain separate clips. Packs without a delivered world density use the provisional 256 pixels per unit registration; they carry no gameplay collision or damage authority. Loose title artwork and waypoint source sheets are available as reference assets.

## Library coverage policy

The prepared authoring library must represent every distinct supplied asset and version in the current external library. Resolution, concept/study status, review labels, folder names and current Game selection are not eligibility filters. Archives, duplicate exports and provenance may map to the same logical asset; they do not require duplicate scene objects. Keep provenance and distinguish original drawings from upscaled versions without hiding either.

Native originals retain their own bindings even when Game already uses a processed version of the same source. A cropped or resized Game derivative cannot stand in for its master. Identical prepared bytes may share storage.

Preserve supplied image dimensions, pixels, alpha, animation frames and timing. Complete Scenes includes its 6144×4096 paintings. Scale registration with resolution so a higher-resolution variant does not become a larger world object. Atlas packing size is a preparation setting, not an eligibility limit on supplied images. Rendering checks the actual GPU texture limit and reports unsupported use.

Reconcile explicit preparations against the current external library. Recover moves by content identity, remove entries whose sources are absent, and report unregistered assets, unsupported formats and unresolved registration as coverage gaps. Do not classify an unknown archive as rejected, superseded, deferred or source-only from its name. New import adapters must close these gaps; a successful preparation of the registered subset is not proof of complete library coverage.

Cache budgets limit residency and preparation working space, not asset eligibility. Game builds may select the assets they use, and agents choose when to publish task-scoped assets; those delivery choices must not restrict authoring-library availability. Reference-only presentation records a current integration limitation, not permanent exclusion from scene use.

## Images for game use

Preserve full-resolution originals, alpha, frame registration and timing. Complete scene paintings remain intact and do not repeat unless explicitly authored to Repeat. Inspect representative scene, sprite, effect and UI samples in the renderer when changing an encoding profile; ordinary preparation does not replace that quality review.

GPU cooking requires Khronos KTX-Software 4.4.2 (`ktx` on PATH or `LANTERN_KTX`). Source-quality inspection uses native lossless images. Delivery variants, encoder settings and GPU fallback behavior belong to [pipeline internals](asset-pipeline.md#image-encoding).

## Coverage and limitations

Explicit preparation scans loose files and ZIP members by content identity. Duplicate copies share an image binding; distinct resolution versions remain distinct. Moves update locations; a source absent from the active library cannot be recovered from unrelated storage. The finalized catalog removes stale library outputs. Interrupted candidates resume through a checkout-local checkpoint; every reused producer, source identity and derivative hash is revalidated before activation. Preparation verifies image catalog coverage, native media hashes and the source snapshot before activating its local layer.

Metadata adapters interpret animation timing, pivots and slices. Unrecognized or incomplete animation contracts are listed in the prepared inventory with their actual failure, while the supplied images and native media remain available. The editor's Source inventory & media panel exposes coverage counts, source associations, media previews/downloads and these limitations. It does not invent missing timing or convert source sheets into guessed animation. SVG originals and fonts remain downloadable; SVGs can be previewed as images. Video/audio are available media, not yet playable scene objects; GLB/Blend files require a model importer.

Split source and handoff metadata can reuse a complete animation when its original JSON bytes match and the supplied drawings agree, or resolve a renamed drawing through its declared hash in the active library. Review catalogs and integrity reports without playback timing remain provenance rather than clips. Supplied atlas indices, timing variants, terminal holds and nested runtime registration retain their authored sequence and values.

Shared content is hardlinked and counted once, free disk space is checked, and active leases cannot be evicted. `LANTERN_PREPARE_BUDGET` overrides the preparation workspace target in bytes (default the cache limit). [Publication](#preparation-and-publication) owns bundle partitioning and pin updates. Browser/device verification is required for actual renderer and codec compatibility.

## Preparation guidance

Preserve registration and timing when trimming or packing sprites. Complete scene paintings stay standalone. Use the existing compiler and prove pixel/registration parity for packing changes. Review a representative batch before changing a codec profile across the library. Builds consume prepared artifacts and never cook source artwork implicitly. Implementation details and source references live in [pipeline internals](asset-pipeline.md#incremental-preparation).

## Frequent artwork changes

Run `npm run assets:prepare` after library additions, replacements, moves or deletions, or select known IDs for a scoped refresh. Running previews retain their immutable snapshot; preserve unsaved scene work and reopen the preview when ready to use the refresh. Preserve [importer identity metadata](source-recovery.md#importer-metadata) so moves and replacements retain scene references.

The command reports reconciliation, per-step time and image reuse/encoding counts. Cold imports, changed encoder profiles and publication transfers can take longer than routine edits. Increase `LANTERN_CACHE_BUDGET_GIB` when the reported cache budget cannot hold required authoring outputs. For a named cloud placeholder, use Download Now in Finder and retry after download completes. Source proofs, resume behavior and resource limits belong to [pipeline internals](asset-pipeline.md#incremental-preparation).

## Audio preparation

`assets/audio-sources.json` selects stable sample/cue IDs, source hashes, segments and gains from the sibling `Sounds` library; `LANTERN_SOUND_LIBRARY` overrides the root. `npm run assets:audio-review` writes an external filename classification report. It does not establish auditory approval or licensing.

Run `npm run assets:prepare -- --ids audio` in an environment with FFmpeg/FFprobe 9.x (`LANTERN_FFMPEG` / `LANTERN_FFPROBE` override executables), then inspect playback under [listening and tuning](sound-design.md#listening-and-tuning). Publish task-scoped audio through [preparation and publication](#preparation-and-publication). Full preparation includes audio; ordinary builds require neither FFmpeg nor sources. Pins without an audio manifest preview silently. Encoding and manifest contracts belong to [pipeline internals](asset-pipeline.md#audio-encoding).

## Hero animation bindings

The cursor locomotion selection index supplies 64 facing/travel pairs: eight existing forward runs and 56 new clips. Preparation verifies package and drawing hashes, screen/world vectors, fixed registration and per-frame holds. Supplied runtime drawings remain in place, never mirrored or played backward. Some locomotion exports were resampled by their supplier; their native source drawings remain separate library assets. All moving clips preserve a 40-tick cycle; Game preserves phase when facing or travel changes. The new clips use a reviewed clip-wide 0.82 scale correction against existing idle anatomy; source pixels and foot pivots remain intact. Native proportion, projection and planted-foot variation remain visible at joins, especially when entering the older leaning forward sprints.

| Supplied clips                                      | Game binding               | Reason or limit                                                                                                              |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 64 locomotion pairs                                 | Travel-facing movement     | Game selects the eight forward runs; other pairs remain available for previews.                                                 |
| U/D/L/R idle additions                              | Matching stationary facing | Complete the existing diagonal idles to eight views.                                                                         |
| Existing sweep, lunge, dodge, flare, hit and death  | Existing actions           | Preserve direction coverage, damage windows, movement and invulnerability timing.                                            |
| Finisher                                            | Animation browser          | Distinct attack with no existing finisher mechanic; one DR view.                                                             |
| Knockdown and get-up                                | Animation browser          | Require a grounded/recovery state absent from current combat; one DR view.                                                   |
| Stagger                                             | Animation browser          | A longer balance-recovery step than the current hit response; one DR view.                                                   |
| Standing reach and corrected kneeling pickup        | Animation browser          | Current interactions commit immediately and permit movement; these clips require committed target alignment and 77/99 ticks. |
| Self-heal enter, loop and exit                      | Animation browser          | Potion healing remains instant; the kneeling sequence requires new action admission and interruption rules.                  |
| Channel hold, lantern inspection and exhausted idle | Animation browser          | No corresponding channel, inspection or exhaustion state; one DR view.                                                       |
| Respawn                                             | Animation browser          | Begins kneeling; current checkpoint reconstruction permits immediate control at arbitrary facing.                            |

The new Game frames have reviewed lantern attachment points. Held frames have no inferred motion warp or blade reconstruction. Existing forward contacts remain direction-specific; new clips carry their reviewed alternating contact drawings in the prepared notifies. Single-facing library kits retain their original timing and pixels, and do not certify gameplay contact, root motion or seamless transition registration.
