# Lantern — systems foundation checkpoint

A fixed-orientation three.js / Electron action RPG foundation, version0.3.0. The Court and Upper Landing are regression fixtures. The approved Rust Lamplighter and Clean INK style remain locked; artwork, animation production and encounter polish are deferred.

Read [current decisions](docs/design/current-decisions.md) and [implementation contract](docs/foundation.md). The original design PDF and historical sources/evidence remain preserved.

## Run and verify

Node24.18.0 (24.x), npm11.16.0, WebGL2. Dependencies remain pinned with the lockfile.

```sh
npm ci
npm run dev
npm run desktop
npm test
npm run assets:check     # read-only source/generated/hash/binding freshness
npm run build           # includes typechecking and build identity
npm run build:verify
npm run package:mac     # unsigned arm64 directory
npm run package:win     # x64 directory; runtime verification requires Windows
npm run smoke -- --output tmp/desktop-smoke
npm run benchmark -- --output tmp/benchmark --machine "Named reference machine" --display "Named display and refresh"
```

`package:mac:prebuilt` and `package:win:prebuilt` package verified existing build outputs without repeating the build. If install-script policy skips Electron's binary, run `node node_modules/electron/install.js`.

Smoke tests and benchmarks launch a hidden, non-focusable window by default; macOS keeps it out of the Dock. WebGL rendering and simulation stay active for screenshots and checks. Use `npm run smoke -- --visible` for native focus-loss testing, or `npm run benchmark -- --visible` for visible-window display pacing measurements. Normal app launches still open a window.

Mac application: `release/mac-arm64/Lantern Knight.app`. Windows: copy the entire `release/win-unpacked/` directory. Smoke selects the host executable automatically; `LANTERN_EXECUTABLE` overrides it. `--profile` selects a parent directory for a fresh disposable test profile; only that generated child is removed after the run. Existing files in the supplied directory are preserved. Test output contains screenshots, package/build hashes, runtime versions, passed checks, failures and unavailable checks.

## Behavior and system ownership

WASD moves relative to the screen; mouse aims on the shared walkable surface. LMB chains three buffered sword stages, Shift dashes/cancels designated recovery, RMB casts an aimed cone flare, and Escape pauses. Combat timing and numerical defaults remain unchanged. Native Electron blur and suspend feed the pause/input-clear path.

Visited areas preserve enemy health, positions and cleared state. Named entries/exits select destinations. Player health and remaining cooldown ticks carry through transitions and save/load. Death resets only the current area to its baseline, preserving other visited areas.

Manual saves and transition/death autosaves share one checkpoint. Boot does not automatically load. An existing save stays protected until Load succeeds or New Game is explicitly confirmed in the pause UI. Unreadable/newer/unknown-content saves remain preserved; failures keep a visible status. Saves migrate versions0–2 to v3; settings remain v2.

## Authoring additional systems content

- Add typed actor/area definitions in `src/content/world.ts`: stable IDs, stats/melee timing, bounds, surface, props, spawns, entries and exits. The registry rejects invalid IDs, references and geometry/timing values.
- Add visual bindings and local manifest paths in `src/content/visuals.ts`. Independently registered packs own their canvas/density/anchor/clips; compatible atlas pages share resource leases.
- `GameSession` owns visited state and transactional transitions. Simulation returns immutable fixed-step results. `EventHub` delivers gameplay/animation events with generation-scoped cancellation and a bounded diagnostic history; future audio/effects attach here.
- The existing animation lab selects asset, clip and heading, with silent scrub/step and foot/trim/socket overlays. No new production drawings were created.
- `window.foundation.fixture('systems-fixture')` is a development-content-only verification entry: five enemies, two melee profiles, different bounds and an X-axis ramp. It disables normal save writes. It is not new authored game content.

GitHub Actions runs lightweight PR/main gates. Main/manual dispatch additionally packages and smokes macOS arm64/Windows x64 using the same-run source-identified build. Workflow presence is not a hosted-run result; see the [handoff ledger](docs/handoff.md).

[Asset replacement and production gates](docs/assets.md) · [verification ledger](docs/handoff.md) · [bounded performance](docs/performance.md) · [versions](docs/versions.json)
