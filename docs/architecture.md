# Architecture

## Owners

Application owns boot, input, loading, pause, fixed-step scheduling and persistence. Game and Dev Preview, including its effects fixture, share that lifecycle. Renderer adapters own presentation, while mounted developer sessions own controls and cancellation. Dev Preview owns a shared shell, per-fixture session state and cancellation; inspector selection is separate from specialized animation/calibration rendering. Preview state uses validated session storage and storage-free bridges, never player checkpoints/settings. Simulation owns gameplay; GameSession owns transitions, encounter state and save capture/restore. Presentation owns interpolation, animation, camera rendering, lighting and GPU resources. Core receives plain gameplay definitions and does not load live scene documents.

Authored version 5 scene documents own floor, scenery, camera, surrounds and gameplay geometry. The content resolver produces area geometry, colliders, visuals and asset requirements together. Game currently uses a built-in empty area with the hero. Authored scene files can be replaced or removed; developer presentation fixtures and gameplay test arenas own their setup independently. Presentation receives explicit resolved visuals. Scene parsing validates data; design profiles produce advice. The editor uses the same resolver, and its owned session disposes requests, observers and rendering work together. Optional typed enemy/exit/health-pickup placements convert through that resolver into plain runtime definitions. Draft playtests use the shared Application with a storage-free bridge; core owns collection and checkpoint state. Original artwork and preparation remain separate from placements and gameplay timing.

GamePresentation coordinates RoomPresentation, ActorPresentation and SceneLightingRenderer. Preserve their explicit resource ownership and disposal. The existing Three.js math and content/assets dependencies are intentional; a new engine or UI framework is unnecessary.

AssetRuntime owns pack-batch acquisition for Application and the editor: deduplicate identities, settle pending peers after failure or cancellation, and release the batch once. Callers validate and install a completed batch before releasing the previous room. Lighting companion replacement retains the current textures until all requested companions load successfully; failed batches release only their new textures and remain retryable. Disposal also closes late acquisitions.

Tool entry points call workflows; workflows call process, asset and file helpers. Helpers do not dispatch npm commands or import their callers. Standard tools run directly. Tests/checks execute fresh; immutable prepared assets cache expensive production work.

AssetWorkspace owns the selected asset root, resolved public/metadata paths, identity and release. Development, web compilation and runtime validation receive those paths explicitly. TypeScript preparation operations receive an explicit context with source access, paths, output recording and one budgeted writer. Atlas compilation requires that context; its pages, calibration, report and manifest use the same writer and budget as other preparation outputs. Source reads share exact-case and root-confinement validation. Environment translation remains at command, Python and legacy diagnostic subprocess boundaries. Preview sessions own server acquisition, identity checks and lease release once. Game/Authoring profiles select outputs, asset scope and tool navigation together. Live desktop Game uses the Game capability profile against Vite and keeps preview storage; only authoring profiles expose mode switching. Electron resolves preload beside its main bundle in live and packaged launches. Builds pass source and asset identities explicitly to the writer; the standalone identity command verifies existing artifacts. Artifact checks remain independent of compilation. Web inputs exclude Electron-only source, and web identities cover only web output; packaging composes Electron through the shared build configuration and records a desktop identity covering both outputs. Prebuilt packaging requires a matching desktop identity.

## Import boundaries

`npm run architecture:check` protects browser/runtime imports, the pure gameplay model and presentation direction, including type imports and literal dynamic imports. Runtime code uses the Bridge/browser adapter rather than importing Node, Electron, tests or tools. Core cannot import live scenes or art composition. Keep any exception narrow and explain its actual consumer.

## Change recipes

### Change saved state

Change the current schema, session capture/restore and relevant adapters together. Prototype saves use version 6 and settings version 5; obsolete or incompatible data resets to empty. Storage failures remain visible. Adapters own one write queue and snapshot requests; Electron writes atomically. Browser and desktop use new prototype namespaces. Test with `npm test -- tests/unit/persistence.test.ts tests/unit/application.test.ts`. Add migrations when external players create a real compatibility need.

### Add an area or enemy

Author scene geometry and visuals together, and extend actor/encounter/exit definitions in content. Keep simulation independent of art. Check pure transitions, collision and combat, then run the affected browser scene scenario. Existing development checkpoints can reset when IDs or geometry become incompatible.

### Change action timing or presentation

Authored hero holds, gameplay tuning and simulation own timing at 60 Hz. The hero's melee definition owns base/lunge reach and an optional sweepRange override (otherwise falling back to base reach); action timing owns the damage window. Sweep defaults to the selected Quick preset shared by the simulation, retimed presentation clips and effect clock, with optional per-actor preview overrides. It changes no raster assets or persisted fields; the original authored timing remains available for comparison. Down-right sweep recovery replaces only the final drawing with the canonical idle frame, retaining the penultimate pose and selected holds while keeping visual scale consistent at the action-to-idle join. Animation callbacks never commit damage. Preserve generation-scoped immutable events, fixed-step outcomes and resource disposal. Use action/foundation unit tests, prepared-asset tests for registration changes, and optional native diagnostics for visual investigations.

GamePresentation owns shared CombatFeedback. Application acquires its two catalog assets with initial scene assets and retains their leases; presentation reset/disposal clears effects and subscriptions before releasing those assets. Damage events queue one Contact Shear at each confirmed target, regardless of attacker kind. The sweep effect uses its original pre-painted camera-facing view and fixed registration, scale and timing; it never decides damage or changes the artwork geometry.

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
