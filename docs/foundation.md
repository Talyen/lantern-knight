# Runtime foundation

`Application` owns boot, asset leases, input, pause, fixed-step scheduling and persistence. Game and Sandbox create their respective presentations through the same lifecycle. Session operations preserve pause requests made while reading or loading and resume only an unchanged foreground request. Disposal prevents late asynchronous acquisition or startup from reviving an application.

`GameSession` owns transactional area transitions, visited encounter state, resets and save capture/restore. Simulation owns collision, supports, combat timing, health and cooldowns. Events carry immutable fixed-step values and generation-scoped lifetimes.

Content definitions own stable actor/area/spawn IDs and authored supports. Art placements require explicit asset/clip IDs and purposes; mounted attachments require mount data. Room dependencies derive from placements, floor, surrounds and tiles, with a separate procedural-resource list; artwork and animation do not determine damage timing. Prepared manifests own registration, source canvas, density, trim, pages and clip timing. Typed registration data supplies walk fields and alpha coverage through the asset loader. Explicit scenery presets define reusable lamp defaults independently of room ordering. Authored inline lights and separate fixtures normalize into one resolved fixture array for rendering, effects and construction diagnostics; existing scene document version 1 and locked structures are retained.

`GamePresentation` coordinates the shared renderer, camera and presentation lifecycle. `RoomPresentation` owns scene construction and room resources; `ActorPresentation` owns actor animation, interpolation and visual resources. `SceneLightingRenderer` owns the production lighting/postprocessing pipeline, with concrete shadow-proxy and focus-mask helpers. Sandbox extends it with current inspection tools; Effects Playground has an independent scene. GPU resources are leased or explicitly disposed. Saved visual settings are separate from checkpoint authorization.

Player, Dev Preview and Sandbox profiles are isolated. Sandbox cannot write checkpoints. Existing checkpoints remain protected until a successful Load or confirmed New Game; unreadable, unknown-content and newer data are preserved. Game saves use version 6; settings remain version 5. Valid version 5 chapel positions are checked against the former room bounds before reconciliation to supported roots, preserving vital state and encounter progress.

Asset preparation is an art-authoring operation. Normal builds and CI consume the verified pack pin, use an external bounded cache, and keep generated data out of the source tree. See [assets](assets.md).

Scene surrounds belong to area visuals, separate from playable bounds. Nearby scenery remains grounded; middle and far painted woodland use camera-relative parallax at 0.85 and 0.65. The background renders before gameplay with a depth clear between them, and shares the final color treatment. Authored ground footprints and a narrow terrain rim replace the oversized floor in the churchyard and ruined chapel. Backdrop cards do not cast shadows, receive wetness or obscure actors. Calibration, animation and Effects views retain their own backgrounds.

Golden/Diorama at 150% is the shared default. Authoring can select alternate rigs and looks; scene rendering does not force a different player preset. Developer comparisons use the current runtime assets and animator. Historical study actors and effects do not belong to the active catalogs.

## Import boundaries

`npm run architecture:check` enforces the existing layer direction on tracked and nonignored untracked source, including type-only imports, re-exports, import types, require and dynamic imports. Runtime source cannot import Electron, Node built-ins, tests or tools; it uses browser adapters and the `Bridge` contract. Core, content and runtime assets can depend on one another and their existing libraries, including Three.js math, but cannot import application, UI, presentation or developer entry points. Presentation consumes those layers. The pinned TypeScript native API parses and resolves module edges; missing configuration/source files fail the check.

This gate does not impose an acyclic graph or prohibit existing content/art relationships. Developer content remains authored data; player catalog exclusion and artifact identity checks retain separate ownership. Literal dynamic targets are required so boundaries can be checked. New exceptions require an explained owner change and meaningful regression protection.

## Change recipes

These recipes describe current owners, not new gameplay requirements. [Contributing](../CONTRIBUTING.md#verification) owns the regular gates; focused checks below supplement the final full test run. Keep intended features and unresolved decisions in [design intent](game-design.md) and the [roadmap](roadmap.md).

### Change saved state

1. Classify the field as checkpoint data, visual settings or transient session/presentation state. [Save schemas and parsing](../src/core/save.ts) own persisted shapes, defaults, versions and migration; decide whether a version bump is needed before changing them.
2. Update [session capture/restore](../src/core/session.ts) and [Application](../src/application.ts) lifecycle wiring together with schemas and representative fixtures. If the transport changes, update the `Bridge` contract, browser adapter, Electron preload and [slot storage](../electron/store.ts) together.
3. Preserve [write authorization and ordered snapshots](../src/core/persistence.ts), Player/Dev Preview/Sandbox isolation, and unreadable, unknown-content or newer checkpoint bytes. Loading and confirmed New Game authorize writes; presentation settings do not. A schema change must not silently reset an existing checkpoint.
4. Exercise round-trip/default/migration behavior, write authorization, browser storage and file recovery with `npm test -- tests/persistence.test.ts`; this suite needs no artwork. Add `tests/systems.test.ts` for area transitions and session integration. Use the player smoke journey for a changed save/load interaction; distinguish automated storage evidence from a visible playtest.

### Add an area or enemy

1. Extend [content definitions and validation](../src/content/world.ts) with stable area, actor, entry and spawn IDs. Preserve existing IDs used by saved encounters; define legal exits, activation, collision/support geometry and melee behavior rather than deriving gameplay from art.
2. Wire [area visuals](../src/content/world-art.ts) and [actor/asset mappings](../src/content/visuals.ts) through their existing owners. Keep developer fixtures in [Sandbox content](../src/content/sandbox-world.ts). New artwork follows the [asset workflow](assets.md); ordinary content work consumes the pinned pack.
3. Check initialization, traversal, elevation/collision, death retry and revisits through `npm test -- tests/systems.test.ts tests/churchyard.test.ts`. For scene handoff, run `npm run check:task -- --scene court --capture` (or `upper-landing`) and inspect the edited location. Use packaged journeys for player interaction changes and exhaustive smoke captures only for a concrete visual investigation. Saved layouts with unknown IDs remain protected until an explicit compatibility policy handles them.

### Change action timing or presentation

1. Resolve consequential input-buffer, cancellation or lantern-design choices in [design intent](game-design.md) first. The prototype cone/stagger and complete-attack dodge policy are current behavior, not final design commitments.
2. [Authored hero holds and boundaries](../authoring/hero-actions.json), [timing conversion](../src/content/hero-actions.ts), [gameplay tuning](../src/content/gameplay.ts) and [simulation](../src/core/simulation.ts) own action durations, damage, movement and cooldowns. Keep changed timing consistent at the fixed 60 Hz step; animation callbacks must not commit gameplay.
3. Update [visual mappings](../src/content/visuals.ts), [sprite presentation](../src/presentation/sprite.ts) or animation treatment only where needed. Preserve generation-scoped immutable events, resource disposal and checkpoint separation. Changes to hashed pack inputs, including `src/content/asset-catalog.ts`, require finalization under the [runtime composition boundary](assets.md#runtime-composition-boundary). Other presentation changes consume the existing pack; ordinary builds do not regenerate artwork.
4. Exercise action boundaries and buffering with `npm test -- tests/hero-actions.test.ts tests/foundation.test.ts`; add `tests/animation-treatment.test.ts` or `tests/rest-rendering.test.ts` when those contracts change. Reuse the animation lab and existing smoke tools for presentation comparisons, then visibly playtest aiming, cues and [feedback](game-design.md#player-action-feedback). Tests cannot certify final TEST-art quality or monitor pacing.

### Change player menus or settings

1. Keep player UI in [game UI](../src/game-ui.ts), lifecycle and accepted operations in [Application](../src/application.ts), and gameplay input in [Input](../src/core/input.ts). Keep player and Dev Preview behavior aligned; developer-only controls stay in Sandbox. Reuse native buttons, labels, selects and ranges rather than introducing a second UI framework.
2. For pause and confirmation polish, move focus to a visible eligible control when opening, contain focus in the active panel and restore it to the opener or game canvas on close. Escape dismisses the top choice first; underlying gameplay must not receive confirmation/menu input. Native select/text behavior takes precedence. Held confirmation keys must not activate a newly revealed action; movement keys retain their intended repeat/hold semantics.
3. Give unavailable actions an inspectable reason. Acknowledge asynchronous operations, block duplicate activation while pending, and report success only after the operation succeeds. Preserve checkpoint authorization and the [player feedback](game-design.md#player-action-feedback) contract. Closing or replacing a panel must prevent late work from refocusing it.
4. Verify the changed flow in the packaged player smoke journey: keyboard and pointer activation, nested confirmation cancellation, focus return, held keys, pending/failure states and save protection. Add only coverage that exposes a consequential failure. Native dialogs own focus containment/restoration and the pause menu dismisses New Game confirmation before resuming on Escape. Checkpoint operations share pending-state protection. New gamepad mapping and broader accessibility features need their own product design.

### Introduce audio

Use the [audio contract](audio.md) when implementing the planned sound and music. Add the runtime owner, lifecycle wiring and representative failure/lifetime tests together. Asset preparation and publication remain explicit authoring operations; adding this recipe does not prepare or select sounds.
