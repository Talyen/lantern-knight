# Bounded packaged performance and memory pass

The harness now launches hidden by default. Use `npm run benchmark -- --visible` for measurements of a visible window's display pacing. Hidden-mode results identify that boundary explicitly and do not replace the visible-window evidence below.

## Current systems foundation v0.3.0

Measured6 October2026 on the same named MacBook Air M5/16 GiB/60 Hz reference and selected2560×1440 buffer, render scale1 and DPR cap1. [Current raw evidence](../evidence/systems-v0.3/performance.json) records the package hash and actual renderer. macOS packaged WebGL2/ANGLE Metal only; Windows shipping-hardware certification remains unavailable.

| Fixture | Samples | Median interval | p95 interval | Maximum | Intervals >33.4 ms | Active fixed ticks |
|---|---:|---:|---:|---:|---:|---:|
|4 actors,60 seconds|3600|16.7 ms|18.1 ms|18.7 ms|0|3590|
|32 actors,15 seconds|900|16.7 ms|17.9 ms|18.7 ms|0|895|

Each fixture has a5-second warm-up. Measurement stops before screenshot capture; fixture state remains active for the capture, then the original session/resources are restored without normal save writes. The harness rejects a paused/stalled simulation. Dropped simulation time was zero. These are rAF intervals, not pure CPU/GPU work times; GPU timing is unavailable. p95 remains above the ideal16.67 ms target, and120 FPS is not established.

Eight Court replacements settle at60 geometries/6 textures. The separate five-enemy/X-ramp smoke fixture settles at57/6 across eight replacements. These are object counts, not authoritative GPU-byte measurements or long-duration leak proof. Shared atlas content remains four2048² RGBA8 pages,64 MiB base GPU estimate and1,947,893 compressed file bytes; the memory ledger below still describes those unchanged pages and provisional graphics-budget limits.

## Preserved v0.2.0 reference pass

Measured on **6 October 2026**. Raw results: [`evidence/performance.json`](../evidence/performance.json). This is a macOS reference result, not selected Windows shipping-hardware certification.

## Reference environment and method

MacBook Air **Mac17,3**, Apple **M5**, 10-core CPU (4 performance / 6 efficiency), **8-core GPU**, **16 GiB** RAM, macOS **27.0 (26A428)**. Built-in 2560×1664 Retina display, 60 Hz. ANGLE reports `Apple M5 / Metal Renderer`. Packaged unsigned arm64 Electron **44.5.1**, Chromium **152.0.7977.130**, embedded Node **24.21.0**, three.js **0.186.1**, WebGL 2. Production-minified JS, explicitly allowed diagnostic/historical placeholder content; no approved art-quality claim.

The harness sets logical content to 2560×1568 so header/footer leave a **2560×1440** game canvas. It asserts the actual drawing-buffer dimensions before measuring. OS DPR is **2**, renderer DPR cap is **1**, render scale **1**; Retina does not multiply the intended game buffer. Windows larger than the laptop's logical desktop are used for capture/measurement; this is an offscreen-extent desktop fixture, not a fullscreen Windows test. No dynamic resolution or fidelity reduction is used.

Five-second warm-up, then 60 seconds of a seed-142 four-actor encounter. A separate five-second warm-up precedes 15 seconds of 32-actor stress. The autonomous input follows a circle, aims at an alive enemy, attacks, dodges and flares; death/clear resets the deterministic encounter while reusing scene resources. Effects are bounded to the hero slash and flare, plus enemy telegraph rings/contact shadows. No post-processing or spawned-particle library. Geometry, lights and shared atlases match the playable room. The extra development browser was closed for this run.

| Fixture | Samples | Median interval | p95 interval | Maximum | Intervals >33.4 ms | Snapshot draw calls / triangles |
|---|---:|---:|---:|---:|---:|---:|
| Representative, 4 actors | 3599 | 16.7 ms | 18.2 ms | 18.7 ms | 0 | 24 / 1280 |
| Modest stress, 32 actors | 899 | 16.7 ms | 18.2 ms | 18.7 ms | 0 | 73 / 2008 |

Neither final fixture had an interval above 33.4 ms. Dropped simulation time was zero. Median is consistent with 60 Hz pacing, but p95 at 18.2 ms is above the ideal 16.67 ms target. No clear isolated rendering bottleneck was established by this bounded interval measurement. `requestAnimationFrame` intervals include display scheduling and presentation; they are **not pure CPU or GPU work times**. GPU timing was not measured reliably and is marked unavailable. A 120 Hz result is not possible from this 60 Hz display fixture and is not promised.

The first attempt was rejected because macOS clamped the canvas height to 668 rather than 1440. That raw attempt is retained in `performance-window-clamped.json` with a rejection reason. The renderer/test-window fix and drawing-buffer assertion were applied before the table's rerun. No bottleneck requiring a visual-quality tradeoff appeared in the corrected bounded pass. The current systems foundation uses one surface-query-generated ground mesh; sprites keep independent geometry/materials.

## Asset and graphics memory ledger

Current generated set: **200 original frames**, four **2048×2048** RGBA8 PNG pages, no mipmaps, **73.1%** trim occupancy. It includes the 16 controlled d45 drawings plus eight-view diagnostics. Hero and enemy reuse those pages; actor count does not duplicate textures.

| Category | File bytes | Decoded / resident estimate | Notes |
|---|---:|---:|---|
| Hero + diagnostic enemy shared atlas pages | 1,947,893 (1.86 MiB) | **64 MiB** RGBA8 base-level GPU; up to another 64 MiB decoded image backing | Width×height×4; compression does not shrink resident pixels; implementation may share/retain backing storage |
| Contact-shadow texture | procedural, no file | **16 KiB** base RGBA | Shared 64×64 texture, no mipmaps |
| Environment | procedural | **0 authored texture bytes** | Opaque colored meshes; geometry buffers are separate |
| Calibration rig | 52 KiB GLB | **0 authored texture bytes** | Flat materials and small mesh buffers; persists for lab switching |
| Slash, flare, telegraphs | procedural | **0 authored texture bytes** | Colored ring geometry, no VFX atlas |
| HUD/UI | CSS/system text | browser/compositor glyph/backing bytes **unavailable** | Included as an unknown category; not claimed free |
| Post-process render targets | none | **0** | No bloom or custom offscreen pass |
| Default framebuffer / MSAA / depth | no file | **at least 28.1 MiB** for one RGBA8+32-bit depth-sized pair at 1440p | Multisampling, resolves, swapchain and browser composition add implementation-dependent storage; a 4-sample color/depth+resolve approximation would be ~140.6 MiB before extra swapchain buffers |
| Temporary fetch/decode storage | transient | PNG bytes + RGBA decode copies, up to several page-size buffers | Four decodes run asynchronously; no KTX2/transcode buffers |

The configuration's **256 MiB scene texture budget is provisional**. Known authored textures are about 64 MiB plus 16 KiB. Default framebuffer/compositor/decoder/driver memory is tracked separately above, including its unknowns; the whole graphics-residency ceiling is **not certified**. `renderer.info.memory` object counts are not a GPU-byte meter. The unsigned macOS app is roughly 320 MiB including Electron, distinct from content file bytes and graphics residency.

## Lifetime result

Eight sequential room replacements after stress return to exactly **60 geometries / 6 texture objects** in every recorded sample. The desktop smoke independently verifies eight resets and interrupted concurrent load suppression. Stress peaks at 125 geometry objects in the measured snapshot and returns to baseline; atlases remain six renderer texture objects including shadow/internal resources. Shared hero page leases remain live, while room meshes/materials/actor buffers are disposed. The application shutdown releases the final shared texture and ImageBitmap leases.

This short settled-count result does not establish hours-long leak freedom or exact process/GPU bytes. It does demonstrate no unexplained room-reset growth in this checkpoint. Next performance acceptance is the same packaged Windows fixture on a named shipping GPU/display, with the approved content set and a finalized memory budget.

The measured v0.2.0 package uses unchanged existing placeholders, selected camera v2/span13, three-hit combo and generation-based room resets. Canonical Rust/Clean INK art is deferred by the owner. Linked-area/raised-ground verification is covered by the desktop smoke; this bounded benchmark measures the Court encounter/stress fixture.
