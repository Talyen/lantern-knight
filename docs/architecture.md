# Architecture

## Owners

Application owns boot, input, loading, pause, fixed-step scheduling and persistence. Game and Sandbox share that lifecycle. Simulation owns gameplay; GameSession owns transitions, encounter state and save capture/restore. Presentation owns interpolation, animation, camera rendering, lighting and GPU resources. Core receives plain gameplay definitions and does not load live scene documents.

Authored version 5 scene documents own floor, scenery, camera, surrounds and gameplay geometry. Production content composes these with actor, encounter and exit definitions, producing matching area geometry, visuals and asset dependencies. Scene parsing validates data; design profiles produce advice. The editor uses the same resolver. Original artwork and preparation remain separate from placements and gameplay timing.

GamePresentation coordinates RoomPresentation, ActorPresentation and SceneLightingRenderer. Preserve their explicit resource ownership and disposal. The existing Three.js math and content/assets dependencies are intentional; a new engine or UI framework is unnecessary.

Tool entry points call workflows; workflows call process, asset and file helpers. Helpers do not dispatch npm commands or import their callers. Standard tools run directly. Tests/checks execute fresh; immutable prepared assets cache expensive production work.

## Import boundaries

`npm run architecture:check` protects browser/runtime imports, the pure gameplay model and presentation direction, including type imports and literal dynamic imports. Runtime code uses the Bridge/browser adapter rather than importing Node, Electron, tests or tools. Core cannot import live scenes or art composition. Keep any exception narrow and explain its actual consumer.

## Change recipes

### Change saved state

Change the current schema, session capture/restore and relevant adapters together. Prototype saves use version 6 and settings version 5; obsolete or incompatible data resets to empty. Storage failures remain visible. Adapters own one write queue and snapshot requests; Electron writes atomically. Browser and desktop use new prototype namespaces. Test with `npm test -- tests/unit/persistence.test.ts tests/unit/application.test.ts`. Add migrations when external players create a real compatibility need.

### Add an area or enemy

Author scene geometry and visuals together, and extend actor/encounter/exit definitions in content. Keep simulation independent of art. Check pure transitions, collision and combat, then run the affected browser scene scenario. Existing development checkpoints can reset when IDs or geometry become incompatible.

### Change action timing or presentation

Authored hero holds, gameplay tuning and simulation own timing at 60 Hz. Animation callbacks never commit damage. Preserve generation-scoped immutable events, fixed-step outcomes and resource disposal. Use action/foundation unit tests, prepared-asset tests for registration changes, and optional native diagnostics for visual investigations.

### Change player menus or settings

Keep native DOM controls and the shared Application lifecycle. Verify focus return, nested confirmation cancellation, accepted input, pending operations and failure feedback. Settings remain separate from checkpoints; Sandbox cannot write checkpoints. Use application tests and the Game browser scenario.

### Introduce audio

Follow the [audio design](audio.md), keeping gameplay authority and media lifetime explicit. Add the owner and focused failure/disposal checks together.
