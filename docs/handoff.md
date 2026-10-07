# Current handoff

The asset architecture is migrating to a small authored repository, the existing external source Asset Library, one pinned prepared pack and a bounded external cache. Original artwork and the current Game/Dev features are preserved.

Source-aware fidelity and freshness checks run during preparation on the Mac. Normal development and hosted CI consume prepared assets and validate their integrity and runtime contracts. Delivery verification includes Game/Dev builds, artifact identities, macOS/Windows packaging, player controls and persistence, Sandbox routing, Crypt rendering, preferences, weather and the Effects Playground.

Only completed checks establish verification. The release response records the exact final commit and hosted job conclusions after CI finishes. Hidden tests do not establish visible display pacing, release signing or behavior on untested GPUs.

Windows hosted checks select Chromium’s documented ANGLE/SwiftShader software backend. The player interaction journey uses its existing 50% quality option; dedicated renderer checks retain native-resolution coverage. Software-runner timeouts are bounded separately from product timing.
