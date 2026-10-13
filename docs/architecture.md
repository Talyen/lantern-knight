# Architecture

## Owners

| Owner                      | Responsibility                                                                  | Main location                                  |
| -------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Application                | Boot, input, loading, pause, fixed-step scheduling and persistence operations   | `src/application.ts`                           |
| Simulation and GameSession | Gameplay outcomes, transitions, encounter state and checkpoint capture/restore  | `src/core/`                                    |
| Content                    | Gameplay definitions, scene parsing/resolution and explicit visual requirements | `src/content/`                                 |
| Presentation               | Interpolation, animation, camera rendering, lighting and GPU resource disposal  | `src/presentation/`                            |
| Developer sessions         | Editor/preview controls, temporary state, mounted requests and cancellation     | `src/editor/`, `src/sandbox/`                  |
| Storage adapters           | Shared validation, browser storage and atomic desktop writes through Bridge     | `src/platform/`, `electron/`                   |
| Asset tools                | Source preparation, immutable delivery, workspaces and cache leases             | `tools/assets/`                                |
| Development tools          | Guide discovery, checks, test selection, builds and preview processes           | `tools/` (asset operations in `tools/assets/`) |

## Application lifecycle

Game and Dev Preview, including its effects fixture, share the Application lifecycle. Dev Preview's shell retains per-fixture state; opening an inspector is separate from entering dedicated animation/calibration rendering. Preview state uses validated session storage and storage-free bridges, never player checkpoints/settings. Mounted developer sessions dispose their requests, observers and rendering work together.

Editor startup failure uses the same complete shutdown path as normal disposal. `src/editor/preview-images.ts` owns thumbnail and animated-preview image loading: at most six active decodes, a shared LRU cache capped at 48 pages and 64 MiB of decoded RGBA pixels, retryable failures, and latest-request canvas acceptance. Each live canvas separately retains its displayed page so an oversized animated atlas does not reload every frame; weak canvas keys allow removed thumbnails to be collected. Disposal cancels active image loads, settles queued requests and prevents late painting. These images do not borrow GPU pack leases.

SceneContent binds scene composition and asset requirements to the ContentRegistry that produced them. Application owns the active session and SceneContent together; its registry, checkpoint validation and New Game derive from that binding. Switching registries requires a read-only application; developer hosts provide storage-free bridges. Game retains the registry selected by its storage adapter.

Application exposes a frozen SessionView for inspection and checkpoint capture, keeping GameSession's replacement commands private to its owner. Its `sim` property borrows the stable SimulationView, with no gameplay command methods and deeply read-only actor, drop and collection types. Ordinary hosts execute gameplay through Application, which steps its owned Simulation and executes player interactions. Developer controls and inspection tools use synchronous `editPreview` callbacks, admitted only in a read-only application with an accepted room and no loading work or pending session operation; disposal closes that admission. Developer step hooks and new-session preparation retain explicit mutable access for fixture setup and replay. Borrowed views remain tied to their original room after replacement. Developer replacements submit SceneContent and a new-session specification or checkpoint; Application constructs the matching GameSession, assigns its generation and creates feedback before acquisition. Checkpoints are validated and detached at admission. New-session preparation may configure preview actors synchronously; it cannot choose room identity or generation. The public API never transfers a caller-owned GameSession into the active application.

Application startup owns one resource graph and frame scheduler for its lifetime. Concurrent, reentrant and repeated `boot()` calls share the same startup promise. Failure closes the application and its acquired resources; retry creates a new Application. Disposal stops waiting for host settings and observes but discards late results. Asset acquisitions still settle and release late leases.

Application owns one current session operation spanning checkpoint reads, room acquisition, commit, persistence and completion. `SessionOperations` owns admission, cancellation, completion and terminal disposal; operation bodies borrow only a signal and cancellation-aware reads/checks. Admission installs the next owner before aborting its predecessor, so a newer intent submitted by a synchronous cancellation callback supersedes the admitting operation. Loading callbacks are also checked before operation work begins. Completion clears only its own ownership; disposal closes admission and clears ownership before aborting callbacks. A newer Load, Restore, Reset, New Game, transition or developer room replacement supersedes the previous operation. Superseded operations cannot commit, resume play or start an autosave; expected cancellation stays out of error feedback. Transition plans cancel immediately. Storage reads stop blocking loading on cancellation and discard late results; resource acquisitions settle and release late leases. Disposal cancels session operations and the separate retained/preview asset lifetime. Writes already submitted remain ordered by the storage adapter.

Simulation steps return death-reset and transition requests without replacing the session. Application executes death recovery through the same room transaction as manual reset; it publishes reset feedback and autosaves only after acceptance. Developer command hooks can return an explicit reset request, which stops the current fixed step and uses the same room transaction. A hook that starts a session operation also stops that step before consuming input or advancing gameplay. Preview actor overrides remain mutable, while Simulation's area and generation are read-only. Headless session replay owns its GameSession directly and explicitly commits reset requests without renderer preparation.

GameSession prepares every travel, rest, reset and checkpoint restore as a single-use RoomPlan. Preparation validates admission and constructs the destination simulation, area snapshots and progression before Application acquires renderer resources. The candidate stays private to GameSession; its public plan exposes only destination, source generation and start feedback. Failed preparation preserves the active simulation and progress. Cancellation discards the candidate, and superseded or already consumed plans cannot commit. Application checks the plan before revoking room acceptance; commit transfers the prepared state without reconstructing gameplay. Headless callers use the same commit contract, with synchronous reset/rest/restore conveniences preparing and committing immediately.

GameSession owns simulation, inventory, visited areas, discovery and counters in one accepted RoomState; commit swaps that owner once. Every room candidate receives detached inventory, including travel, rest and reset. Simulation borrows read access to its own inventory and write capabilities checked against the accepted inventory owner. Retired rooms cannot award loot or consume potions in the accepted session. A pending plan suspends inventory writes, equipment/salvage commands and campfire discovery; cancellation restores source-room admission, and failed candidate construction preserves the previous plan. Public progression properties have no setters, discovery reads are detached sets, and checkpoint admission remains the path for headless state setup.

Room replacement has a separate acceptance barrier. Before committing gameplay changes, Application revokes room acceptance; committing a generation immediately aborts old event feedback. Acceptance returns only after renderer rebuilding and companion preparation both succeed under the current operation. A failure after commit pauses the application and blocks simulation steps, renderer updates, resume and checkpoint writes until a successful Reset, Load, Restore, New Game or developer room replacement. An empty Load does not recover the room. Failures before commit preserve the previous accepted room. Asset leases remain owned through failed rebuilding as described below; recovery does not roll back committed gameplay.

## Scene content

### Direction, camera and input ownership

`src/content/headings.ts` owns world-yaw heading identifiers and selection, shared by combat, authored action timing and asset clips. Gameplay never loads camera calibration or asset delivery at runtime; animation helpers may borrow type-only clip contracts. `src/assets/camera-contract.ts` binds baked projection to runtime framing, `src/assets/camera-calibration.ts` owns preparation calibration, and `src/assets/sprite-registration.ts` maps source trim rectangles around their anchors. Asset validation consumes these definitions directly.

`src/presentation/camera.ts` owns Three.js camera construction, viewport constraints, projection and screen-relative movement. `src/input.ts` adapts DOM input and pointer projection into gameplay commands under Application's lifetime. Rendering and browser input do not live in the gameplay model. Camera and direction algorithms remain shared across Game, editor and preview consumers through their respective owners.

### Content acceptance

ContentRegistry clones and deeply freezes gameplay definitions before validation. Its private lookup indexes and public definition snapshot share the same accepted objects; callers retain editable drafts. Scene composition separately snapshots visual definitions and freezes their derived asset requirements, so draft edits cannot change live geometry, checkpoint validation or rendering requirements. Registry acceptance validates every hero entry and the complete enemy spawn jitter segment against actor clearance, so Game, transitions, headless sessions and editor playtests cannot bypass placement validation. Replace content by constructing a new registry and scene composition. Editor renames follow scene acceptance rather than mutating the active simulation.

### Scene documents and ground interaction

Version 5 scene documents own floor, scenery, camera, surrounds and gameplay geometry. `src/content/scene-document.ts` parses them; `src/content/world-art.ts` resolves area geometry, colliders, visuals and asset requirements together. `src/content/world-visuals.ts` owns visual types, resource requirements and framing helpers.

The optional `groundInteraction` block binds normalized image contours to an exact asset hash, frame and dimensions; independent world-space polygon footprints resolve into ordinary blocking props. Depth anchors or left-to-right piecewise boundaries belong to presentation. `src/content/floor-layout.ts` owns both artwork/world mappings and resize reprojection. Image coordinates start at the top left, with Y increasing downward; floor rendering converts them to bottom-left texture UVs at the presentation boundary.

Scene documents allow 4 MiB; fragments retain 64 KiB. Saved contours need no model to load. Editor saves additionally retain immutable authored revisions in `authoring/ground-profiles`, independently of scene and asset-library lifetimes. `src/content/ground-profile.ts` owns explicit artwork reassignment and floor reprojection; changed image content requires alignment review. Ground replacement requires clearing or reauthoring interaction data.

`src/presentation/ground-occlusion.ts` owns the source-sized coverage/depth atlas and actor fragment masking, including hidden silhouette outlines. GPU size limits reject unsupported scenes explicitly.

Parsing protects technical validity; design profiles produce advice under [scene guidance](scene-design.md).

### Area state and reconstruction

`src/core/area-state.ts` owns the area checkpoint schema, registry validation and encounter-respawn policy. Simulation captures detached area state and accepts saved state only during construction, through the same validator used by full checkpoint admission. It reconstructs enemy positions, health, death poses, local alerts, pickups, claims and drops together. Action clocks, movement requests and object animation ticks remain transient.

GameSession retains area snapshots and selects when to revisit or respawn them; it never reconstructs enemy actors or assigns simulation collections. Rest and death combine fresh encounter state with retained claims, pickups and non-enemy drops. Room travel and checkpoint loading retain local alerts, so reconstruction cannot silently lift combat restrictions. Version 7 checkpoints without the optional `alerted` spawn-ID list remain readable and start without local alerts.

### Collision and navigation

`src/content/collision.ts` owns footprint geometry, circular clearance, swept contact queries and corrective placement projection. Registry acceptance, checkpoint validation and navigation share position clearance; spawn jitter, route segments and smoothing share segment clearance. Projection is a best-effort correction and never proof that a position is valid. Checkpoints use the same minimum actor radius as movement. Footprint caches retain only immutable props.

`src/core/navigation.ts` owns movement sliding over those swept contacts and deterministic eight-neighbor A* at 0.2 world units. Route diagonals cannot cut corners. Walking, dodging, separation and editor Walk hero use the same sweep. Enemy pursuit replans at most every 15 ticks and requires unobstructed melee contact. Transient targets and route diagnostics never enter checkpoints.

`src/core/encounter-behavior.ts` owns local awareness, group alerts, sanctuary/leash policy and enemy intents. It borrows read-only actors and never moves them or starts combat actions. Simulation applies those intents and coordinates action resolution and event ordering. The shared actor model lives in `src/core/actor.ts`.

`src/core/movement-plans.ts` owns room-local navigation and transient routes for manual commands, home return and pursuit. Switching automatic intent replaces its route immediately; moving targets within the same intent retain the 15-tick planning cadence. Manual targets take priority until completion or cancellation. Awareness never edits route caches. Simulation creates both owners for its immutable area, clears both on repopulation, and captures/restores only awareness through area state. Navigation diagnostics borrow detached route data without initializing the planner.

### Combat actions and fixed-step ordering

`src/core/combat-actions.ts` owns attack/dodge/ability admission, input buffers, action entry and interruption, hit geometry, damage, invulnerability, stagger and recovery. Each Simulation constructs one combat owner for its immutable area and generation. The owner borrows current actors through a live capability view, so repopulation and developer actor replacement cannot leave it targeting retired actors. It does not retain a second actor collection or advance action clocks.

Simulation owns the fixed-step sequence: cooldowns and previous positions, hero command admission and locomotion, then each enemy's intent followed by that actor's action resolution. All actor ages advance together after combat, preserving dodge protection at the same action tick regardless of actor iteration order. Separation, pickups, room-clear detection and exit requests follow. Combat uses explicit room capabilities for supported movement, event emission, enemy awareness, death drops and breakable claims; inventory, navigation plans, checkpoints and room replacement remain outside its contract. The existing Simulation action commands delegate to this owner for developer setup and headless callers.

### Editor documents and playtests

Editor playtests use the world-art resolver through `src/content/draft-gameplay.ts` and run the shared Application with a storage-free bridge. Optional enemy, exit and health-pickup placements become plain runtime definitions; core owns collection and checkpoint state. Core does not load live scene documents. Original artwork and preparation remain separate from placements and gameplay timing.

`src/editor/gestures.ts` owns one captured pointer gesture across viewport dragging, marquee selection, geometry handles, transform controls and ground strokes. Tools borrow leases; completion releases capture before committing. Document operations suspend admission and cancel the current preview before editing or replacing scenes. Tool changes, focus loss, hidden documents, lost capture and disposal revoke the same lifetime, so late releases cannot apply old targets to replacement documents. Ground multi-click proposals and AI requests retain their separate tool-owned lifetimes.

EditorDocument owns committed editor history. EditorHistory stores deeply frozen scene snapshots; changes receive detached mutable drafts. Read-only consumers receive a frozen history facade rather than the live history owner. A staged history is forked before validation and rendering, so retained edit callbacks cannot mutate an in-flight candidate or the accepted history. Undo/redo share only immutable scenes; fragments and resolved visual data are detached editable outputs. All edits, undo/redo, imports, opening scenes and recovery restores stage a candidate and validate gameplay before applying it to EditorView. Only view acceptance commits the candidate; selection and local recovery updates follow that commit. Failed application restores the previously committed view and preserves its undo/redo history.

EditorView exposes its renderer and simulation only while an accepted room is available. Rebuilding revokes that acceptance before mutating the renderer; acceptance returns after warming and companion preparation succeed. If rebuilding and document rollback both fail, frame rendering and scene interaction remain blocked until a successful apply recovers the view. Failures before renderer mutation preserve the previous accepted room. Disposal discards pending candidates without reopening the view. Inspectors and composition tools read the committed snapshot; edit callbacks receive a separate mutable history. Saving reidentifies the accepted history without adding an undo step.

`src/editor/project.ts` owns scene file revisions, dirty-state baselines, authenticated writes and workspace-scoped local recovery. Open, import and recovery restore change file metadata only after EditorDocument accepts the replacement. Selecting a recovery leaves the active file identity intact until restoration succeeds; unreadable recoveries remain available for export or dismissal. Successful server saves accept their revision before optional recovery cleanup, so unavailable browser storage cannot leave the editor using an obsolete revision. The saved baseline records the document actually written, preserving later edits as dirty. The UI owns confirmation, operation admission and feedback; the project owner receives its request, storage and cancellation dependencies explicitly.

### Game content selection

Game runtime and builds share the content and asset selection in `src/content/game-content.ts`, which resolves the selected orchard and clearing authored documents. Saving under `authoring/scenes/` does not add a scene to Game; follow [Add an area or enemy](#add-an-area-or-enemy) to register it. Authored scenes are replaceable; developer presentation fixtures and gameplay test arenas own their setup independently. Asset preparation and runtime delivery retain their curated catalog independently of scene selection.

## Runtime resources

GamePresentation coordinates RoomPresentation, ActorPresentation and SceneLightingRenderer. Preserve renderer ownership and disposal. The existing Three.js math and content/assets dependencies are intentional; a new engine or UI framework is unnecessary.

Presentation borrows `SimulationView` from `src/core/simulation-view.ts`, with read-only actors, collections and current-tick fields; it cannot call simulation commands. Application and editor pass the stable `Simulation.view` facade. Views are live borrows, not retained snapshots, and TypeScript protects nested state from writes. Navigation diagnostics return detached data without initializing gameplay navigation. Developer render hooks use the same view; deliberate gameplay overrides remain in the application step hooks.

### Asset ownership and disposal

Application and EditorView revoke availability before shutdown callbacks. Their teardown, GamePresentation and the asset owners attempt each peer cleanup in dependency order. Renderer disposal is attempted before borrowed asset leases release; pool closure invalidates all claims, including pending decodes. `src/assets/cleanup.ts` owns synchronous cleanup fault containment: one failure is rethrown unchanged, multiple failures form an AggregateError, and unwinding an operation preserves its original error as the cause. Cancellation listeners report cleanup failures through the pending acquisition promise rather than throwing from EventTarget dispatch. Failed shutdown remains terminal; repeating disposal does not rerun consumed ownership. This guarantees cleanup attempts, not successful destruction by a failing external callback.

AssetRuntime snapshots its catalog and accepts fetched and seeded manifests through one identity-checked boundary. Accepted manifests, frames and clips are deeply frozen and exposed as read-only data; parsing and preparation retain mutable `ManifestDraft` values. Consumers cannot change validated page identities, geometry or timing.

AssetRuntime owns pack-batch acquisition for Application and the editor: deduplicate identities and own completed packs until transfer. Failure or cancellation immediately releases completed packs and cancels pending texture claims, while acquisitions still settle and dispose late results. Independent consumers retain their own claims; batch release is idempotent. Callers validate a completed batch before transferring it to `SceneAssets`, the shared room-lease owner for Application and EditorView. Its stable read-only view exposes the installed batch. Installation consumes the batch even if synchronous renderer rebuilding throws; both generations remain leased because a partial renderer may reference either. A successful rebuild releases superseded batches; renderer disposal precedes closing SceneAssets. Failures in later asynchronous preparation leave the installed batch owned for retry or document rollback. Editor replacements acquire a complete batch, sharing decoded textures through ResourcePool rather than manually transferring individual leases.

Each room batch includes its SceneContent's initial assets and area requirements, so replacing content acquires the new hero and feedback packs and releases the old source with the room. Application separately owns explicitly retained assets and one replaceable preview pack. Presentation borrows read-only pack views without release capability. Its pack map derives from those ownership groups, including preview overlap with a room or retained asset.

AssetRuntime closes its manifest requests and ResourcePool on disposal. Pool closure invalidates all leases, releases loaded textures once, and disposes late decode results before acquisition can succeed. Closed runtimes reject reads, seeding and acquisition. Failed pool batches release their claims immediately and settle pending peers before reporting failure; other consumers retain their own claims. Presentation must dispose before its runtime owner closes.

### Lighting resources

Lighting loads companions only for selected packs. Replacement retains current textures until all requested companions load successfully; failed batches release only their new textures and remain retryable. Disposal also closes late acquisitions.

The hero lantern illuminates nearby scene surfaces with broad distance falloff, without a billboard glow. Its source follows reviewed native drawing sockets in `src/content/hero-lantern-sockets.json`, transformed with the displayed frame's registration, stabilization, animation blend and mesh transform. These coordinates belong to the current hero handoff; a changed handoff disables the fallback until its sockets are reviewed. Asset preparation preserves this authored content.

## Tooling and builds

Tool entry points call workflows; workflows call process, asset and file helpers. Helpers do not dispatch npm commands or import their callers. Standard tools run directly. Tests/checks execute fresh; immutable prepared assets cache expensive production work.

AssetWorkspace owns the selected asset root, resolved public/metadata paths, identity and release. Development, web compilation and runtime validation receive those paths explicitly. TypeScript preparation operations receive an explicit context with source access, paths, output recording and one budgeted writer. Atlas compilation requires that context; its pages, calibration, report and manifest use the same writer and budget as other preparation outputs. Source reads share exact-case and root-confinement validation. Environment translation remains at command, Python and legacy diagnostic subprocess boundaries.

Preview sessions own server acquisition, identity checks and lease release once. Game/Authoring profiles select outputs, asset scope and tool navigation together. Live desktop Game uses the Game capability profile against Vite and keeps preview storage; only authoring profiles expose mode switching. Electron resolves preload beside its main bundle in live and packaged launches. Builds pass source and asset identities explicitly to the writer; the standalone identity command verifies existing artifacts. Artifact checks remain independent of compilation. Web inputs exclude Electron-only source, and web identities cover only web output; packaging composes Electron through the shared build configuration and records a desktop identity covering both outputs. Prebuilt packaging requires a matching desktop identity.

## Import boundaries

`npm run architecture:check` protects browser/runtime imports, the pure gameplay model and presentation direction, including type imports and literal dynamic imports. Runtime code uses the Bridge/browser adapter rather than importing Node, Electron, tests or tools. Core cannot import live scenes or art composition. Core runtime imports cannot load asset modules; shared heading rules belong to content, while type-only animation clip contracts remain allowed. Keep any exception narrow and explain its actual consumer.

## Change recipes

### Change saved state

Gameplay checkpoint schemas and registry validation belong to `src/core/save.ts`; renderer settings belong to `src/platform/settings.ts`. `src/platform/bridge.ts` owns the host protocol, while `src/persistence.ts` owns application write feedback. Browser and desktop adapters share `src/platform/storage-codec.ts` for detached write snapshots, payload limits and invalid-data handling. Game entry points select the content registry explicitly when creating adapters; storage never selects production content internally. Change checkpoint capture/restore and the relevant codec together. Prototype saves use version 7 and settings version 5; obsolete or incompatible data loads as empty. Storage failures remain visible. Adapters validate writes; Electron snapshots requests, serializes them through one queue and replaces files atomically. Browser and desktop isolate prototype profiles. Test with `npm test -- tests/unit/persistence.test.ts tests/unit/application.test.ts`. Add migrations when external players create a real compatibility need.

### Add an area or enemy

Author scene geometry and visuals together. For Game, register the area and its resolved visuals in `src/content/game-content.ts`; saving an editor draft alone does not change Game. Extend actor definitions in `src/content/actors.ts` and their art bindings in `src/content/visuals.ts` when needed. Keep simulation independent of art. Check pure transitions, collision and combat, and cover changed browser behavior under [test selection](verification.md#test-selection). Existing development checkpoints can reset when IDs or geometry become incompatible.

### Change action timing or presentation

Authored hero holds, gameplay tuning and simulation own timing at 60 Hz. The hero's melee definition owns base/lunge reach and an optional `sweepRange` override, falling back to base reach; action timing owns the damage window. Sweep defaults to the Quick preset shared by simulation, retimed presentation clips and the effect clock. Preview overrides change no raster assets or persisted fields. [Sweep review](developer-tools.md#sweep-review) owns preset timings and recovery comparisons.

Supplied actor kits use the nearest delivered facing for each action without mirroring. Authored scene placements still require their requested clips and headings.

Animation callbacks never commit damage. Preserve generation-scoped immutable events, fixed-step outcomes and resource disposal. Use action/foundation unit tests, prepared-asset tests for registration changes, and optional native diagnostics for visual investigations.

EventHub delivers gameplay and animation feedback in publication order. Reentrant publication waits behind the current batch; new subscriptions start with the next event, and unsubscribe takes effect immediately. Replacing a generation aborts old subscriber work and stops stale queued or in-flight delivery. Disposal closes the hub permanently. A subscriber exception or current-lifetime promise rejection removes that subscriber, aborts its pending work and reports one diagnostic through Application status without interrupting peers, gameplay, transitions or autosaves. Rejections from aborted lifetimes are discarded; subscribers must use the supplied AbortSignal to cancel their own asynchronous effects.

GamePresentation owns shared CombatFeedback. Its two catalog assets belong to SceneContent's initial requirements and are acquired with each room batch under [SceneAssets ownership](#asset-ownership-and-disposal). Room reset clears active and queued effects before superseded batches release; application disposal closes presentation and its event subscription before asset release. Positive damage events queue one Contact Shear at each confirmed target, regardless of attacker kind. The sweep effect uses its original pre-painted camera-facing view and fixed registration, scale and timing; it never decides damage or changes the artwork geometry.

### Change player menus or settings

Keep native DOM controls and the shared Application lifecycle. Verify focus return, nested confirmation cancellation, accepted input, pending operations and failure feedback. Settings remain separate from checkpoints; Sandbox cannot write checkpoints. Use application tests and the Game browser scenario.

### Introduce audio

Follow [planned audio](#planned-audio), adding the playback owner and focused failure/disposal checks together.

## Planned audio

Sound and music remain [planned](roadmap.md#now). These are implementation requirements, not an existing playback system. [Assets](assets.md) owns media preparation and publication; [player action feedback](game-design.md#player-action-feedback) owns feedback intent.

Use one runtime playback owner with injectable media, clock and timer seams. Application boot/disposal owns its lifetime; resolved session events supply gameplay cues. Audio never commits damage, progression, transitions or saves. Essential feedback survives mute, missing media and failed playback; success cues require accepted outcomes.

One-shots have pending, playing and finished lifetimes. Cancel pending work on disposal or session replacement and clean up media, handlers and timers through one idempotent path. Late callbacks cannot affect replacement sounds or newer cooldown reservations. Delayed cues start cooldown on actual playback; cancelled/muted pending cues consume none, and failed playback releases its own reservation.

Music/ambience have one requested destination and an active owner. Superseded loads/fades cannot start late; failed destination changes preserve usable outgoing audio. Master/music/SFX settings update live playback separately from checkpoints. Choose voice limits, repeat suppression, pause, crossfade, room-loop and mute/unmute policies with the sound design.

Playback failure is non-fatal and reports bounded diagnostics without blocking gameplay. Check stale loads, failed playback, mute/unmute, transitions, pause and disposal at the cheapest meaningful layer. Listen in Game and Dev Preview for overlaps, loop seams, levels, first use and cleanup; lifetime tests do not certify the mix. Keep tuning and registrations in code/content and record established behavior here when implemented.

## Adventure interactions

`src/content/items.ts` owns fixed equipment compatibility, rewards and salvage yields; `src/content/interactions.ts` owns authored campfires and interactive object definitions. Authored gameplay resolves their positions with scene artwork. Simulation owns local awareness, sanctuary limits, sword breakage, object claims, drops and potion timing. Presentation samples object clips from authoritative claim ticks; animation callbacks never award items.

GameSession owns one `InventoryState` across room replacements. `src/core/inventory.ts` owns detached, frozen inventory/equipment snapshots and atomic commands. Loot, potion consumption, equipment and salvage commit only after validation. Simulation receives only read, reward and consumption capabilities through its constructor; it cannot replace inventory or edit equipment. Session and simulation consumers read frozen records and reacquire them after commands. Checkpoint admission shares the owner's item-count, slot-compatibility and equipped-copy validation. Invalid or overflowing rewards and salvage preserve both the previous inventory and any uncollected drop; equipment changes clamp hero health to the resulting maximum. Checkpoint capture exports detached mutable data, and restore constructs a new owner before binding the replacement simulation.

`src/core/interaction.ts` owns explicit interaction eligibility. Prompts and command admission resolve the same target identity, living hero, 1.6-unit reach, floor height, unobstructed contact and applicable guard/combat restrictions. Simulation admits container opening and drop collection; GameSession admits campfire discovery, rest, fire travel and explicit departures. Application owns loading, feedback and persistence after admission. Automatic trigger exits retain their simulation trigger path. Object reward commits are private to Simulation: containers require an admitted open command, and breakables require a confirmed sword hit. A displayed prompt grants no lasting permission; commands query current state again.

GameSession also owns campfire discovery, encounter revisits and reset policy. Rest and death reset enemies across visited areas while retaining claimed objects and collected items. Death chooses the shortest reachable route to a discovered fire in the current stage, falling back to the last visited fire. Travel preserves health and encounter state. Application admits room replacement and autosaves accepted changes. Inventory and campfire dialogs use the same session operations; equipment never replaces hero artwork.
