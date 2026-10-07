# Runtime foundation

`Application` owns boot, asset leases, input, pause, fixed-step scheduling and persistence. Game and Sandbox create their respective presentations through the same lifecycle. Disposal prevents late asynchronous acquisition or startup from reviving an application.

`GameSession` owns transactional area transitions, visited encounter state, resets and save capture/restore. Simulation owns collision, supports, combat timing, health and cooldowns. Events carry immutable fixed-step values and generation-scoped lifetimes.

Content definitions own stable actor/area/spawn IDs and authored supports. Art placements reference asset/clip IDs; artwork and animation do not determine damage timing. Prepared manifests own registration, source canvas, density, trim, pages and clip timing. Typed registration data supplies walk fields and alpha coverage through the asset loader.

`GamePresentation` owns the shared renderer and room lifecycle. Sandbox extends it with current inspection tools; Effects Playground has an independent scene. GPU resources are leased or explicitly disposed. Saved visual settings are separate from checkpoint authorization.

Player, Dev Preview and Sandbox profiles are isolated. Sandbox cannot write checkpoints. Existing checkpoints remain protected until a successful Load or confirmed New Game; unreadable, unknown-content and newer data are preserved. Saves/settings currently use version 5.

Asset preparation is an art-authoring operation. Normal builds and CI consume the verified pack pin, use an external bounded cache, and keep generated data out of the source tree. See [assets](assets.md).

Golden/Diorama at 150% is the shared default. Authoring can select alternate rigs and looks; scene rendering does not force a different player preset. Developer comparisons use the current runtime assets and animator. Historical study actors and effects do not belong to the active catalogs.
