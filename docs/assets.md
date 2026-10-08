# Asset ownership and verification

The shared source authority is `~/Documents/Asset Library/2d Assets/Lantern Knight`, backed up in iCloud. `ASSET_LIBRARY_ROOT` overrides the library location. Original archives and current project originals remain unchanged. The compact source index has an 80 KiB authored-input cap and records archive/loose-file identities and paths as hints; [automatic recovery](source-recovery.md) handles reorganization without accepting different bytes.

Code, authoring recipes, the pack pin and small controlled fixtures belong in Git. Raw collections, expanded catalogs, atlases, registration arrays, captures and logs remain outside the checkout. The two original hero reference images are explicit repository exceptions; their bytes and the canonical Clean INK prompt are preserved.

The Last Tended Light Graveyard kit uses the small [authored registration recipe](../authoring/graveyard-art.json). Selected native PNGs, exact prompts and provenance remain in the external `last-tended-light-v1` source group. Preparation preserves native RGB, removes generated low-alpha backdrop contamination with a recorded alpha remap, and pads cutouts without scaling their drawings. Native resolution and requested model are recorded independently; the built-in tool does not expose model routing or size controls.

## Preparation and publication

`assets:prepare` reads only selected members from verified source archives, creates derivatives in a reserved external workspace, and verifies source fidelity, corrected walk drawings, alpha-aware atlas packing, registrations and generated freshness. It prepares only active Game and developer catalogs. The fixed-view studies remain provisional; delivery changes do not grant production-art approval.

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

## Current hero TEST selection

The current hero uses the pinned 7 October 2026 v02 handoff, corrected import records, plus four cardinal run packages, totaling 273 selected native drawings. Historical walk, actor, environment and combat-effect studies remain external originals and are excluded from active catalogs. The original DL/DR/UR/UL views map world +Z/+X/−Z/−X. New screen D/R/U/L runs fill world headings d45/d135/d225/d315, completing eight-direction locomotion; idle and actions retain their four supplied views. The screen-D run intentionally uses six drawings; the other new runs use eight. All run cycles remain 40 ticks. Native canvas, pivot and density are recorded per frame, including mixed ready/action Sweep densities. Runtime geometry uses these values without resizing, mirroring or adding root motion.

LMB requests alternating Sweep and Lunge, beginning with Sweep. Attacks finish before the next buffered attack or dodge; no combo or finisher scaling applies. Alternation survives damage, dodges and area transitions but is not saved. Directed holds in `authoring/hero-actions.json` determine action duration and damage/pulse boundaries at 60 Hz. Sweep lasts 54 ticks with damage at ticks 18–24; Lunge lasts 42 ticks with damage at ticks 12–16. These windows are shared across all action directions. Dodge lasts 30 ticks and travels 2.1 metres only in cels 4–5 (ticks 6–14), sharing those travel ticks with invulnerability. Hit lasts 24 ticks, Lantern 60 ticks with its pulse at tick 24, and Death 90 ticks before reset. Source handoff timing and original raster bytes remain preserved separately.

These are supplied TEST assets with approximate registration and known pose/endpoint differences, not newly certified production artwork. At 3840×2160 and 9 metres vertical span, the least-dense hit pose has 0.901 native pixels per output pixel; all poses reach at least 1× from 9.99 metres. The quality gate checks this selected native baseline separately while retaining previous headroom requirements for existing assets. No raster enlargement is used to claim higher native resolution.

## Local preparation review

A replacement pack can be prepared and exercised locally before publication. Use `npm run assets:prepare`, then append `--local` to asset-backed checks/builds/smokes. This explicitly selects the validated preparation entry, checks its recipe and complete inventory, and holds a cache lease. Ordinary development and CI continue to use `assets/lock.json`; local review does not change that pin. Publication requires separate approval after local validation.

## Current animation treatment

The prepared registration contains clip/direction-specific guarded transition fields, mixed-frame canvas/pivot/density mappings, original holds, bounded presentation offsets and weighted walk holds. The small `authoring/hero-motion.json` recipe owns native-space correspondence markers, reviewed sword segments and visibility, signed rotation, residual offsets and loading/release/settling treatments. Torso markers seed correspondence; they do not establish measured anatomical retargeting or root motion. Original four-direction Weighted Walk holds are preserved; new cardinal runs use reviewed loading holds within their supplied 40-tick cycle, retaining the balanced six-drawing D rhythm.

Runtime defaults to guarded treatment, stabilization and rigid-sword protection with directed action timing. Loaded poses hold before accelerating; release is fast, recovery slows into rest and idle breathes gently. Body coherence remains guarded by silhouette/color checks. Reviewed fully hidden swords permit body-only warp; uncertain short occluded blades, changing visibility and incoherent poses retain held drawings. Rigid sampling follows the reviewed blade segment, respects the native hand/occlusion paint and uses the same signed rotation for color, lighting, shadows and focus. Native projected length changes are retained. Raster sources, pivots and densities are unchanged.

Dev comparison offers Treatment (identical directed timing, corrected versus held drawings) and Timing (directed versus imported rhythm on shared elapsed time). The visual timeline shows directed drawing boundaries, damage windows and lantern pulse; status explains held fallbacks. Seeking is silent and preview controls do not write saves. Field textures stay below 4096 pixels per dimension; generated data and captures remain external. Optical flow cannot supply missing poses: rear death drawings end kneeling, and some partially occluded equipment cannot be safely interpolated.

## Chapel sanctuary artwork

The 12 by 18 metre Ruined Chapel uses selected native Clean INK altar, lantern-bearer window, intact and broken pews, and connected roof-collapse drawings from the external `chapel-sanctuary-v1` source group. The small [registration recipe](../authoring/chapel-art.json) records their native canvases, ground roots and densities. Original images, exact generation prompts, native dimensions and hashes are preserved with provenance in the Asset Library; model routing and native-size controls were not exposed by the built-in generation tool.

The quiet flagstone material is uniformly reduced from its 1254-pixel native square to a 1024-pixel standalone mipmapped page. Cutout source pixels are retained. Painted daylight and cool limestone balance the surviving altar candles, including when optional relighting is disabled. At the default 9 metre setting, entry framing eases from an elevated 11 metre view to the normal 9 metre view by the nave; larger saved framing selections remain unchanged.

For a visual scene review, `npm run smoke:crypt -- --local --capture --stills` retains the composition matrix and native stills while still exercising motion, occlusion and resource checks. Omit `--stills` to also export normal and quarter-speed motion images.
