# Bounded packaged performance and memory pass

Measured on **6 October 2026**. Raw results: [`evidence/performance.json`](../evidence/performance.json). This is a macOS reference result, not selected Windows shipping-hardware certification.

## Reference environment and method

MacBook Air **Mac17,3**, Apple **M5**, 10-core CPU (4 performance / 6 efficiency), **8-core GPU**, **16 GiB** RAM, macOS **27.0 (26A428)**. Built-in 2560×1664 Retina display, 60 Hz. ANGLE reports `Apple M5 / Metal Renderer`. Packaged unsigned arm64 Electron **44.5.1**, Chromium **152.0.7977.130**, embedded Node **24.21.0**, three.js **0.186.1**, WebGL 2. Production-minified JS, explicitly allowed development/proxy content.

The harness sets logical content to 2560×1568 so header/footer leave a **2560×1440** game canvas. It asserts the actual drawing-buffer dimensions before measuring. OS DPR is **2**, renderer DPR cap is **1**, render scale **1**; Retina does not multiply the intended game buffer. Windows larger than the laptop's logical desktop are used for capture/measurement; this is an offscreen-extent desktop fixture, not a fullscreen Windows test. No dynamic resolution or fidelity reduction is used.

Five-second warm-up, then 60 seconds of a seed-142 four-actor encounter. A separate five-second warm-up precedes 15 seconds of 32-actor stress. The autonomous input follows a circle, aims at an alive enemy, attacks, dodges and flares; death/clear resets the deterministic encounter while reusing scene resources. Effects are bounded to the hero slash and flare, plus enemy telegraph rings/contact shadows. No post-processing or spawned-particle library. Geometry, lights and shared atlases match the playable room. The extra development browser was closed for this run.

| Fixture | Samples | Median interval | p95 interval | Maximum | Intervals >33.4 ms | Snapshot draw calls / triangles |
|---|---:|---:|---:|---:|---:|---:|
| Representative, 4 actors | 3600 | 16.7 ms | 17.6 ms | 17.7 ms | 0 | 22 / 3362 |
| Modest stress, 32 actors | 899 | 16.7 ms | 17.6 ms | 17.8 ms | 0 | 82 / 4538 |

Neither final fixture had an interval above 33.4 ms. Dropped simulation time was zero. Median is consistent with 60 Hz pacing, but p95 is above the ideal 16.67 ms target. `requestAnimationFrame` intervals include display scheduling and presentation; they are **not pure CPU or GPU work times**. GPU timing was not measured reliably and is marked unavailable. A 120 Hz result is not possible from this 60 Hz display fixture and is not promised.

The first attempt was rejected because macOS clamped the canvas height to 668 rather than 1440. That raw attempt is retained in `performance-window-clamped.json` with a rejection reason. The renderer/test-window fix and drawing-buffer assertion were applied before the table's rerun. No bottleneck requiring a visual-quality tradeoff appeared in the corrected bounded pass. Tiles already use one simple InstancedMesh; sprites keep their ordinary small independent geometry/materials.

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

The configuration's **256 MiB scene texture budget is provisional**. Known authored textures are about 64 MiB plus 16 KiB. Default framebuffer/compositor/decoder/driver memory is tracked separately above, including its unknowns; the whole graphics-residency ceiling is **not certified**. `renderer.info.memory` object counts are not a GPU-byte meter. The unsigned macOS app is roughly 310 MiB including Electron, distinct from content file bytes and graphics residency.

## Lifetime result

Eight sequential room replacements after stress return to exactly **61 geometries / 6 texture objects** in every recorded sample. The desktop smoke independently verifies eight resets and interrupted concurrent load suppression. Stress peaks at 136 geometry objects in the measured snapshot and returns to baseline; atlases remain six renderer texture objects including shadow/internal resources. Shared hero page leases remain live, while room meshes/materials/actor buffers are disposed. The application shutdown releases the final shared texture and ImageBitmap leases.

This short settled-count result does not establish hours-long leak freedom or exact process/GPU bytes. It does demonstrate no unexplained room-reset growth in this checkpoint. Next performance acceptance is the same packaged Windows fixture on a named shipping GPU/display, with the approved content set and a finalized memory budget.

The measured package uses the final v2 constant-limb exports and the documented vertical-plane/background-ground depth policy. Final packaged smoke coverage also includes defeat-prompt/progression fixes.
