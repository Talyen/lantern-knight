# Implemented foundation contract

## Confirmed versus provisional

Confirmed: three.js + Electron, fixed orientation, directional 2.5D sprites, male sword/lantern hero, WASD/mouse aim, dodge and lantern action, Windows shipping priority and macOS development. Clean original graphic shapes and readable combat are the visual objective.

Provisional and configurable: TypeScript; orthographic v1 at 45° azimuth / 35.2643897° elevation; 12-unit vertical span; 1.8-unit hero; 60 Hz simulation; LMB/RMB bindings; screen-relative travel; sword right / lantern left; short damaging/stunning flare; numeric gameplay tuning; cloth colors and every proxy design detail. **No design/camera/sample approval has been received.** The supplied archive contains no finished art or approved concept.

`src/content/camera.json` is the single bake-space contract consumed by compiler, runtime, Blender script and calibration. The old draft `art_contract.provisional.json` is a reference, not a second active format. Changing projection/angles increments contract ID and bake version and requires exports to be regenerated. The initial ID is `lantern-camera-v1-proxy`. Presentation render scale changes drawing resolution, not the bake projection.

## Axes, projection and source density

Right-handed game coordinates: XZ ground, +Y height. Heading zero = +Z; positive yaw turns toward +X, `atan2(x,z)`. Azimuth is measured from +Z toward +X; camera offset is +X/+Z. Elevation is above XZ. Camera orientation and span stay fixed; in play, camera and target translate together with the interpolated hero foot (configurable `tuning.cameraFollow`). This keeps the Knight visible at room corners. Comparison controls affect only the actual 3D calibration rig. Returning to play restores v1. No sprite sets are generated for comparison angles.

At azimuth 45°, elevation 35.2643897°:

- Camera outward ≈ (0.57735, 0.57735, 0.57735).
- Screen right ≈ (0.707107, 0, −0.707107).
- Screen up ≈ (−0.408248, 0.816497, −0.408248).

`public/generated/calibration.json` contains computed exact floating values, camera-world/view/projection matrices and all eight projected headings. d45 moves screen-down/toward camera; d225 screen-up/away. Labels are world headings, not screen compass directions. Ties quantize toward the increasing heading, with a 0.045 radian hysteresis band around the current facing.

W travels toward −X/−Z; D toward +X/−Z. Diagonals are normalized. `screenMovement` also supports a world-relative convention. Pointer coordinates account for the canvas client rectangle and use an orthographic ray/XZ intersection.

At 2560×1440, screen density = 1440/12 = **120 pixels per projected world unit**. A 1.8-unit vertical figure projects roughly 1.8×cos(35.264°)=1.47 units, about 176 screen pixels before equipment and stride extent. Source density is **192 px/unit**, giving 1.6× oversampling. A 384×432 canvas covers 2×2.25 projected units. The untrimmed ground anchor is (192,348); origin is top-left, +x right, +y down. The source resolution leaves room for sword and stepping feet without a compulsory 512-pixel square.

Trim placement is reconstructed as left=(trim.x−anchor.x)/density, top=(anchor.y−trim.y)/density, with width/height from trim/density. Projected quad corners use camera-right/up; a derived depth offset preserves their screen coordinates while keeping actor planes vertical in world space. Foot position comes only from simulation; source image height is never interpreted as raw world-Y height. No nonuniform runtime scaling fixes camera mismatches.

Vertical framing stays 12 units; horizontal coverage follows aspect. CSS canvas size, actual drawing buffer, OS DPR and render scale are recorded separately. DPR is capped at 1 by default, including Retina. Scale can be 0.5/0.75/1. Tests compare both 16:9 and 4:3. The larger-than-screen macOS test-window option lets the harness exercise true 1440p without the OS silently clamping height.

## Module map

| Owner | Implementation | Responsibility |
|---|---|---|
| Desktop privilege | `electron/main.ts`, `preload.ts`, `store.ts`, `security.ts` | protocol, validated narrow IPC, sandbox, app-owned saves |
| Bootstrap / UI | `src/main.ts`, `src/style.css` | async boot, input adapter, HUD, lab and inspection controls |
| Deterministic gameplay | `src/core/simulation.ts`, `src/content/gameplay.ts` | fixed tick actions, collision, damage, cooldowns, enemy behavior |
| Camera / input | `src/core/camera.ts`, `src/core/input.ts` | coordinate contract, quantization, ground aim, normalized movement |
| Presentation | `src/core/animation.ts`, `src/presentation/` | independent visual time, crossed notifies, per-instance geometry/UVs, depth |
| Asset runtime | `src/assets/schema.ts`, `loader.ts` | Zod-derived types, semantic lint, hashed bundle loading/refcounts |
| Offline authoring | `authoring/knight/export.py`, `tools/export.ts` | editable original proxy, repeated fixed-camera export |
| Offline compiler | `tools/compiler.ts`, `diagnostic.ts`, `inspect.ts` | staged frames, deterministic packing, atomic manifest publication, inspection |
| Verification | `tests/foundation.test.ts`, `tools/desktop-smoke.ts` | scoped consequential regressions, packaged bridge/UI/benchmark |

No ECS, React loop, backend, general editor, equipment compositor or alternate renderer was added. Three.js core and GLTF addon come from the same `three` package. WebGL 2 is required.

## Three clocks and action rules

The fixed accumulator uses 60 Hz ticks and interpolated actor transforms. Each frame accepts at most 100 ms / 6 steps and records dropped time. Blur, visibility loss, Escape and power suspend pause and discard accumulator debt/input edges; resuming cannot replay minutes of simulation. Fixed command replay with seeded integer PRNG matches across tested render cadences. This is a deterministic JavaScript simulation for this slice, not universal cross-platform physics certification.

Visual durations are explicit. Walk loops at 800 ms. Sword clips total 600 ms with authored 100/67/33/50/100/100/100/50 ms durations. Simulation sword wind-up is 10 ticks, active ages 10–14, recovery to 36 ticks. Changing drawings does not change damage. Enemy action has its own 30-tick wind-up/58-tick total; the same proxy animation is time-remapped around its strike marker so the telegraph and hit agree.

Locomotion faces travel; idle aims at the mouse; sword and flare lock aim on entry. Dodge locks travel direction, or aim if stationary. Walking sprites remain in-place. Dodge lasts 18 ticks, moves at 7 units/s and is invulnerable at ages 1–12; cooldown 50 ticks. Flare activates at age 10, deals 24 damage in radius 3 and stuns for 50 ticks; cooldown 180 ticks. Damage interrupts into hurt or death; death holds the last visual frame. Attack records target IDs so each is hit at most once. Save restore resets active actions to idle/death intentionally.

Notifies traverse (previousTime,newTime], including skipped drawings and loops. Identity = actor/instance/loop/event. Restart creates a new instance. Seeking changes visual time silently. A per-instance notify high-water time prevents rewind/resume from replaying events already emitted or skipped by a seek; restart resets that watermark. There is no unbounded event-ID cache. Interruption discards future events from the old instance. There is no audio playback implementation in this checkpoint; whoosh/footstep/flash identities are exposed in the lab and remain a seam for audio. Gameplay damage never comes from notifies.

## Rendering, overlap and lighting

Opaque ground/tiles are a defined background stage (depthTest true, depthWrite false, stage −2; grid stage −1). World props/walls use lit standard materials with depthTest/write true at stage 0. These category stages prevent floor depth from clipping camera-facing baked footsteps below their root; they do not patch individual overlaps. Actor anchors sit exactly at simulation ground Y=0. Actor quads use baked-color `MeshBasicMaterial`, sRGB textures, alphaTest 0.05, depthTest/write true, no transparent sorting reliance and no double-lighting. Per-actor UV geometry avoids mutating shared texture offset/repeat. Actor corners receive an outward depth offset = projectedY×tan(elevation), making their world height projectedY/cos(elevation) while leaving orthographic screen X/Y exactly unchanged. This explicit vertical-plane depth approximation prevents a pillar behind the root from cutting the head of a hero in front. It does not infer arbitrary per-pixel 3D anatomy. Draw ties follow stable actor creation order. Soft alpha edges below the threshold are discarded; this is a fixed-scale cutout tradeoff, not support for arbitrary hair translucency.

Contact shadows are shared 64×64 radial decals at ground +0.03, transparent, depth-tested, no depth write. Sword arcs and flare rings use the same effects policy. Floor is just below zero; rings/shadows use small explicit height offsets to avoid z-fighting. No bloom/post-process targets are used.

Pillars, walls, tree trunks/crowns and foreground structures are actual simple 3D geometry with separate crown pieces and independent circular gameplay footprints. This proves depth against the current vertical sprite depth plane without invisible rectangle proxies. Within 1.65 units, geometry ahead of the hero fades to 38% opacity with depth writes disabled; it continues to test depth. This bounded readability rule handles this small room. Geometry outside that zone retains ordinary depth. The hero can still be concealed by farther foreground geometry. General bridges, intricate alpha-hole depth proxies and multi-level overhangs are unsupported. The wall fixture uses a deliberately conservative circular collision boundary, not precise wall-box physics.

Color PNGs are sRGB; output is sRGB once; baked sprites are unlit and not tone-mapped. Flat swatches in calibration match CSS/import numbers. The lantern PointLight affects the floor/geometry, not baked hero pixels; its light/socket world position is a documented foot-relative approximation (−0.25,+0.85,0), while VFX attachment dots use exported per-frame projected pixels. These are distinct spaces.

## Loading and saves

Manifest-first loading validates IDs/contracts/geometry, verifies page SHA-256 and dimensions, decodes asynchronously and pre-uploads textures/compiles materials before play. Bundles boot/hero/room are explicit; room currently shares hero atlases for its placeholder enemy. ResourcePool deduplicates in-flight work, uses release-once leases and disposes textures/ImageBitmaps when final ownership ends. Cancelled completion cannot revive a replaced room. Room reset disposes actor geometry/materials and procedural scenery; persistent hero assets and UI stay owned. The inspection hook has no privileged methods.

Electron enables contextIsolation and sandbox, disables Node integration, denies permissions, navigation, webviews and new windows. Production script CSP permits only self. Only `loadSettings`, `saveSettings`, `loadGame`, `saveGame` cross the bridge. Main verifies the exact main-frame origin and webContents ID and validates ≤16 KiB payloads. The protocol serves only bounded app resource types below packaged `dist`; renderer paths/URLs never select save locations.

Settings and game format version 1 live under userData/saves; slot names are application-owned. Writes serialize, fsync a same-directory temporary file and atomically rename; a validated prior save becomes `.bak`. Corrupt primary with readable backup returns `recovered` and is retained as `.corrupt` on an explicit repair write. Unreadable or newer unsupported files are preserved and writes fail closed. Version 0 progression migrates into a version 1 checkpoint. Tests cover missing/corrupt backup, migration and newer versions. Browser development uses the same typed interface backed by localStorage; packaged tests exercise the actual bridge.

Guidance checked during implementation: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [color management](https://threejs.org/manual/pages/color-management.html), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [protocol](https://www.electronjs.org/docs/latest/api/protocol), [packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [desktop testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing). The installed Blender 5.2.2 API was exercised directly by the successful export; online version-specific API fetch was unavailable. No tutorial-specific old API or beta package was used.
