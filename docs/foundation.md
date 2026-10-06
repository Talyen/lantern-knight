# Lantern implementation contract v0.3

The [current decision ledger](design/current-decisions.md) and unchanged owner design PDF govern this checkpoint. Rust/clean INK is locked; current pixels are engineering placeholders. No camera-selection or hero-redesign approval question remains open. Canonical source/motion quality and measured scale/density still need production validation when real files arrive.

## Camera, coordinates and rendering

`src/content/camera.json` is shared by runtime, compiler and export tooling: `lantern-camera-v2`, bakeVersion 2, exact elevation **35.264389682754654°**, azimuth **45°**, initial vertical span **13 m**, zoom 1. Runtime framing can be 11–15 m; orientation stays fixed. Follow translates camera and target with the interpolated simulation foot. No orbit or automatic zoom.

Right-handed world: XZ ground, +Y height. Azimuth/yaw are from +Z toward +X; yaw=`atan2(x,z)`. Basis is outward=(cos(e)sin(a),sin(e),cos(e)cos(a)), right=(cos(a),0,−sin(a)), up=(−sin(e)sin(a),cos(e),−sin(e)cos(a)). `public/generated/calibration.json` records numeric basis and column-major camera/view/projection matrices in world metres. Eight headings d00…d315; d45 faces the camera and d225 away. Ties go toward increasing heading, with small hysteresis.

W maps to −X/−Z, D to +X/−Z at the selected orientation; diagonals normalize. Input rays use the actual canvas rectangle and the same walkable-height query as movement/rendering. Invalid/zero-sized rays and zero aim vectors retain the last valid aim. The initial facing is retained before any pointer input. Height is single-valued at every XZ point; complex underpasses/stacked levels are unsupported.

Resize holds vertical span; horizontal coverage follows aspect. CSS viewport, OS DPR, effective DPR cap, drawing buffer and render scale stay distinct. Default DPR cap 1 avoids Retina's 4× pixel multiplier. At 1440p, runtime density=1440/13=110.77 px/projected-unit; a 1.8 m ruler projects to 162.8 px. Diagnostic source density192 provides 1.73× oversampling, 1.47× at span11 and 2× at span15. The 384×432 untrimmed canvas and foot (192,348) remain provisional source registration, not approved hero art sizing.

Image origin is top-left (+x right,+y down). Trim bounds reconstruct ((x−anchorX)/density,(anchorY−y)/density). Additional corner depth projectedY×tan(elevation) keeps actor planes vertical in world space while preserving exact orthographic screen X/Y; this explicit approximation helps pillars occlude correctly. It does not infer arbitrary per-pixel anatomy. Foot position uses `heightAt(area,x,z)`; no nonuniform sprite scaling fixes mismatched cameras.

Opaque ground is a defined background stage (depthTest true, depthWrite false), followed by ground grid and ordinary depth-tested world geometry/cutout actors. This prevents baked stepping feet below their virtual root from being cut by floor depth. Actors use unlit sRGB `MeshBasicMaterial`, alphaTest .05, depthTest/write true. Per-instance UV geometry never changes shared texture offsets. Soft contact-shadow decals and translucent effects keep depth tests and disable depth write. Near obstructing props/crowns/caps fade to 38% under an explicit 1.65 m rule. Tall authored geometry/split crowns prove the small scene; general bridges/overhangs are deferred.

Baked colors are sRGB and output converts once. Numeric swatches are verified over dark/light grounds. Dynamic light affects only world geometry; baked actors are unlit. Contact shadows follow the support normal. Flare cone vertices conform to the shared height model. Per-frame image sockets are projected coordinates, not arbitrary physical lights; current lantern light is a documented foot-relative approximation. Final canonical socket positions come from the real source.

## Simulation and action authority

60 Hz fixed ticks, transform interpolation, maximum six catch-up ticks/100 ms. Pause, blur, suspend and resume discard input/time debt. A reset can stop the current catch-up batch. Visual clip time is independent; changing drawings cannot change damage, movement, cooldown or invulnerability. Seeded command replays agree across tested render cadences on this JavaScript implementation; no universal cross-platform physics claim.

Player action tuning is in `src/content/gameplay.ts`; actor/area definitions are in `src/content/world.ts`. Current numerical defaults are not owner-approved combat values:

| Swing | Wind-up / active end / total ticks | Link start/end | Dash cancel from | Range / half angle / damage |
|---|---|---|---|---|
| 01 | 10 / 15 / 36 | 20 / 35 | 18 | 1.65 m / .95 rad / 26 |
| 02 | 8 / 13 / 32 | 18 / 31 | 16 | 1.75 m / 1.05 rad / 30 |
| 03 | 12 / 18 / 44 | completes chain | 22 | 1.9 m / 1.15 rad / 42 |

Sword buffer8 ticks, dash buffer5, combo reset20. Each swing locks continuous mouse aim on entry and owns a fresh hit-once target set. Early buffers expire; links require their window; expired/completed chains restart at01. Dash is blocked during anticipation/active and allowed in designated recovery; it locks travel direction or aim if stationary. Dash lasts18 ticks at7 m/s, invulnerable ages1–12, cooldown50. No stamina.

Flare locks mouse direction, activates at10 ticks, ends at30, cooldown180. Range3 m, half angle.55 rad, damage16 and stagger30 ticks per affected target, once per cast. The .65 m height tolerance is only for this shallow local surface. Debug cone and target markers expose the hit domain. Damage interrupts into hurt/death and clears buffered actions. Visual frames/particles never apply damage.

Court and Upper Landing are local-coordinate regression fixtures linked through declared exits and named entries. Typed area definitions supply bounds, seed offset, props, spawns and a flat or clamped axis-aligned shallow ramp. First entry creates the baseline; revisits restore enemy health, positions and clear state. Player health and remaining cooldown ticks carry across entries. One height/gradient query serves movement, aim, mesh breakpoints, roots and shadow normals. A third diagnostic fixture has five enemies, two melee profiles (including health140/radius.35), different bounds and an X-axis ramp. Its inspection entry disables normal saves.

GameSession owns visited-area records, transition preparation/commit, save capture/restore and reset generations. Loading freezes simulation, retains the previous area's resources and commits only after successful acquisition, validation and upload warmup. Superseded requests release temporary leases.

Death holds a final pose, then after45 simulation ticks resets the **current** area to its declared seeded baseline: health100, living enemies, idle actions, zero cooldowns/buffers/hit sets. Encounter generation increments; old commands/events/actor references are rejected. No inventory/permanent penalty. Renderer observes generation changes and disposes/rebuilds room-owned objects while shared atlases survive. Held input/aim is cleared; catch-up stops at the boundary. Clear count increments on a new encounter clear, not on a cleared-area revisit. Other visited areas survive a death reset. Actions and enemy transient statuses reset on entry/load; player cooldowns advance only through active fixed ticks.

Visual notifies use actor generation, actor ID, clip/action instance, loop and event ID. Time-zero emits once on entry; crossed intervals close old loops before new-loop events. A scalar high-water timestamp suppresses already emitted/skipped events after seek/rewind, without an unbounded ID cache. Interruption replaces the instance. Lab seeks and restored corpse placement are silent; no audio playback module was introduced. Immutable per-tick results carry captured damage, target, pose and action identity. EventHub consumes every catch-up result, deduplicates delivery, exposes a bounded100-event diagnostic history and aborts consumer lifetimes on generation change/disposal. Runtime notifies now reach those consumers rather than being discarded. Action visual time maps to simulation timeline markers; death's last pose holds before reset.

## Architecture and lifetime

| Boundary | Files | Responsibility |
|---|---|---|
| Privileged desktop | `electron/main.ts`, `preload.ts`, `store.ts`, `security.ts` | local protocol, narrow validated IPC, app-owned persistence |
| Bootstrap/UI | `src/main.ts`, `style.css` | async loading, loop, HUD, lab and settings |
| Content/session | `content/world.ts`, `visuals.ts`, `core/session.ts` | validated definitions, stable IDs, visited state and transactional lifecycle |
| Gameplay/input | `core/simulation.ts`, `input.ts`, `content/gameplay.ts` | authoritative fixed-step actions and immutable results |
| Events/saves | `core/events.ts`, `persistence.ts`, `save.ts`, `platform/browser-store.ts` | consumer lifetimes, write authorization, v3 state and development adapter |
| Projection/animation | `core/camera.ts`, `animation.ts`, `presentation/` | basis/rays, clip time/notifies, UVs, depth and rendering |
| Assets | `assets/schema.ts`, `loader.ts`, `tools/` | v2 validation/types, deterministic compiler, hashes, bundles/refcounts, inspection |

No renderer/framework restart, ECS, backend, multiplayer, full inventory/editor or equipment compositor. Three.js core/addons share one pinned package. WebGL2 only. The historical engineering source stays archived; it is not silently promoted to canonical artwork.

Manifest-first loading validates structure/geometry/contracts, verifies page hashes/dimensions, decodes asynchronously and warms upload/shaders before play. Typed catalog/visual bindings select per-character manifests. Page identity includes verified hash, dimensions and decode/render configuration; local frame/page IDs remain isolated. Pack leases deduplicate compatible resources and release once. Player/lab leases persist independently of area leases. Cancelled late loads cannot revive a discarded room; retries discard failures. Room reset releases meshes/materials/geometries; persistent hero/UI/atlas ownership remains. Explicit disposal closes ImageBitmaps/textures; renderer process shutdown destroys its context. The short repeated reset test measures settled object counts, not exact GPU bytes or hours-long leak freedom.

Electron sandbox/contextIsolation are enabled, Node integration disabled, CSP scripts self-only. Navigation/windows/webviews/permissions are blocked; bounded `lantern://app` serves packaged local resource types. Only load/save settings/game cross preload. Main validates exact main frame/webContents and strict per-slot payload limits (1 MiB game, 16 KiB settings); no raw IPC/shell/path operations.

Game **v3** saves contain stable current-area ID, seed, diagnostic clear count, player health/XZ/cooldowns and visited-area enemy records keyed by spawn ID. Height is derived on restore; actions, buffers and enemy temporary statuses reset. Versions0–2 migrate; settings remain v2. Unknown content references refuse fallback and writes. Bounded reads, serialized/fsynced temporary writes, atomic rename and backups preserve corrupt/newer files. Browser storage is a separate adapter; actual Electron bridge tests exercise the desktop policy.

Persistence inspects availability at boot without loading. A readable prior save blocks writes until successful Load or confirmed New Game in the existing pause UI. Manual and autosaves share the slot; autosaves run once after successful transitions and death resets. Save failures preserve the prior checkpoint and hold a visible error until a successful write. Diagnostic/benchmark sessions disable normal writes and use isolated test profiles.

CI runs tests, read-only staged/generated freshness and binding checks, then a build including typechecking once. Source commit and application-file hashes identify the reusable build artifact; mutable Finder `.DS_Store` metadata is excluded without changing or deleting it. Main/manual desktop jobs verify that artifact before packaging and running the portable smoke harness. Output/profile paths are explicit, failure reports retain diagnostics, and OS focus availability is reported separately from exercising the Electron blur handler. Hosted graphical smoke requires actual WebGL2 with the normal rendering backend; no shipping GPU performance inference follows.

The smoke/benchmark harness defaults to a hidden, non-focusable BrowserWindow with background throttling disabled so simulation and WebGL keep running. On macOS it uses an accessory activation policy and stays out of the Dock. `--visible` opts into ordinary window/focus behavior; real OS focus-loss and visible display-pacing checks require that option. The harness creates and deletes its own fresh child profile under the supplied `--profile` directory, preserving existing files there. Normal application launches are unaffected.

API guidance checked against installed versions: [three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [color management](https://threejs.org/manual/pages/color-management.html), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [protocol](https://www.electronjs.org/docs/latest/api/protocol), [packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [desktop testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing).
