# Lantern systems foundation handoff — v0.3.0

Implemented the owner's approved five-phase plan using existing placeholders. Art production, animation production and encounter polish remain deferred. The original design PDF, source artwork and earlier evidence remain preserved. [Current decisions](design/current-decisions.md) record the agreed persistence, authoring and CI rules; [foundation](foundation.md) describes ownership and contracts.

## Review follow-up — 6 October 2026

Reviewed the complete staged/unstaged/untracked change set, including content/session integration, IPC and browser persistence, manifests/source assets, generated atlas hashes, CI/build reuse, authoring tooling and active documentation. Fixed six issues: unsafe deletion of a supplied smoke-profile directory; stale first-click aim after reset/load; write protection bypassed when only an unreadable/newer/unknown-content backup exists; valid unsorted animation notifies dropped by consumer timestamp filtering; unreadable settings silently ignored at startup; inspection backdrop/overlay controls disagreeing with their rendered state.

At the owner's request, smoke and benchmark runs now launch hidden and non-focusable by default, with no macOS Dock entry and active background rendering. `--visible` opts into a real window for native focus and visible display-pacing checks. Normal app launches still show a window.

Passed **39 test groups**, typechecking/build, asset freshness, build identity verification and macOS arm64 packaging. The final package passed **33 hidden desktop checks**, including actual controls/screenshots, save/load/relaunch, preserved settings errors and recovery, repeated replacement and hidden/non-focusable/no-Dock assertions on every launch. Eight replacement cycles retained **57 geometries / 6 textures**. [Review smoke evidence](../evidence/review-v0.3/desktop-smoke.json) and representative screenshots are separate from the original checkpoint evidence below. Current macOS ASAR SHA256 is `2b3f45ca9cc2ad1f3b4e8abb9cbc348468c491ed59ef50a8d8e1635d7c986f39`; the Windows package/evidence below predates these fixes. Windows runtime and hosted CI remain unverified. Hidden mode exercises the Electron blur handler directly; actual native focus changes require `--visible`.

The full **60-second representative / 15-second stress** [hidden benchmark](../evidence/review-v0.3/performance-hidden.json) also passed its simulation-progress checks. This verifies active background simulation/rendering, not visible display pacing or shipping hardware performance. The original benchmark evidence below remains preserved.

## Implemented

1. **Typed content:** stable area/actor/spawn IDs, bounds, shared flat/ramp surfaces, collision props, entry/exit references and configurable melee profiles. Court/Landing retain their existing tuning. The third systems fixture proves five enemies, health140, different radii/timing/bounds and an X-axis ramp.
2. **Session/persistence:** transactional resource acquisition before transitions, persistent partial/cleared revisits, current-area-only death reset, player cooldown carryover and transient-state cancellation. Game saves migrate versions0–2 to v3; settings stay v2. Game/settings limits are1 MiB/16 KiB. Startup protects existing saves until Load or confirmed New Game; boundary autosaves and manual saves share the slot. Corrupt, newer and unknown-content files remain preserved. Browser storage denial and unreadable settings also fail without destructive defaults.
3. **Events:** immutable fixed-step results preserve events across catch-up steps. Gameplay and runtime animation notifications reach presentation consumers with stable identities, generation/disposal abort lifetimes and a bounded diagnostic history. Scrubbing and restored corpses remain silent. No production audio/effects were added.
4. **Asset bindings:** catalog-selected independent manifests, per-pack registration/shadow metadata, isolated frame/page IDs, hash/config-based shared textures and explicit release-once leases. Laboratory asset selection uses the actual runtime. Synthetic padded-canvas/density fixtures reuse unchanged pixel content; they are not authored exports or canonical art.
5. **Verification:** read-only staged/generated/hash/binding freshness, source-identified reusable build artifacts, platform-aware packaged smoke and GitHub Actions for lightweight PR/main gates plus desktop macOS/Windows jobs on main/manual dispatch. Desktop packaging reuses the verified build.

## Passed locally

- **35 focused test groups**, including the retained camera/combat/compiler/IPC regressions and new content, revisits, cooldowns, migrations, protected saves, event lifetime and independent-pack tests.
- Typechecking/build, generated-asset freshness and build identity/hash verification.
- macOS arm64 packaging and **30 actual packaged smoke checks**, with real controls, preload/IPC, pause/resume, linked-area revisit, elevation, autosave protection after relaunch, explicit Load, New Game cancellation/confirmation, runtime notifications, five-actor content and synthetic independent registration.
- Eight repeated systems-fixture replacements settled at **57 geometries / 6 textures** each; interrupted replacement committed exactly one new generation. This establishes bounded settled object counts, not exact GPU bytes or hours-long leak freedom.
- The bounded benchmark on the same package: representative/stress median **16.7 ms**, p95 **18.1 / 17.9 ms**, no intervals over33.4 ms and zero dropped simulation milliseconds. Active simulation advanced3590/895 ticks during the60/15-second fixtures. Court replacement settled at **60 geometries / 6 textures** each. See [performance](performance.md).
- CI YAML/trigger/platform/permissions/artifact routing review, including a regression proving that mutable Finder metadata is excluded while real app tampering, commit mismatches and dirty CI reuse fail closed. Actions are pinned by commit.
- Original design PDF SHA256 remains `cdd7ca1e1b9213dce85dc258992472fd03c67f48723ce76df08e7df3098758f8`; all **211** snapshotted authoring/staged-art files remain byte-identical to the starting checkout.

## Exact verification boundaries

- **OS focus loss unavailable:** this automation host did not grant native BrowserWindow focus. The actual Electron blur handler was exercised directly; it paused ticks, cleared held input and resumed without catch-up. This is not an OS focus-change proof.
- **Windows runtime not run:** the x64 directory was generated locally, but no Windows host executed it. The hosted job is configured to require real WebGL2 and a packaged smoke pass.
- **Hosted CI not run:** the workflow is implemented and reviewed, but these changes have not been committed/pushed. Its macOS/Windows results remain pending a push or dispatch after publication.
- Signing/distribution and shipping Windows hardware performance remain unverified. Reliable GPU timing is unavailable; measured rAF intervals include display/presentation scheduling.
- Production artwork remains deferred. Existing content intentionally fails production validation; canonical source/style/motion proof is still required.

## Build and evidence

Mac: `release/mac-arm64/Lantern Knight.app`. Windows: `release/win-unpacked/` (copy the entire directory). [README](../README.md) contains authoring and verification commands.

Current evidence is under `evidence/systems-v0.3/`: [desktop checks](../evidence/systems-v0.3/desktop-smoke.json), [performance](../evidence/systems-v0.3/performance.json), [package hashes](../evidence/systems-v0.3/package-checksums.json), systems/registration/elevation screenshots and representative/stress captures. Both package ASARs have SHA256 `12782a6f232b61fd06f5775a7b846fe91206329d5f7e31186dc8c0319fd487e7`. Evidence explicitly identifies a dirty working-tree build based on `d3a653b`; it is not an exact committed-source CI pass. Earlier v0.2 evidence remains at its original paths.
