# Handoff and performance evidence

The repository contains authored inputs; the external Asset Library owns originals, one pinned prepared pack supplies normal development and CI, and an external cache bounds disposable data. Original artwork and the current Game/Dev features are preserved.

Source-aware fidelity and freshness checks run during preparation on the Mac. Normal development and hosted CI consume prepared assets and validate their integrity and runtime contracts. Delivery verification includes Game/Dev builds, artifact identities, macOS/Windows packaging, player controls and persistence, Sandbox routing, Crypt rendering, preferences, weather and the Effects Playground.

This document defines evidence requirements; it is not a record of a completed run. Only completed checks establish verification. A task response records the changed behavior, completed checks and material limitations. For a requested commit/push or release, the response records the exact final commit and hosted job conclusions after CI finishes. Hidden tests do not establish visible display pacing, release signing or behavior on untested GPUs.

Windows hosted checks select Chromium’s documented ANGLE/SwiftShader software backend. The player interaction journey uses its existing 50% quality option; dedicated renderer checks retain native-resolution coverage. Software-runner timeouts are bounded separately from product timing.

[Public release](release.md) owns candidate preparation, packaged checks, signing/distribution prerequisites and rollback. [Session replay](session-replay.md) owns recorded production-session evidence.

## Performance comparisons

Use repeatable scenes and action sequences for before/after measurements, including the existing benchmark when it exercises the changed work. Record the commit, pinned asset revision, named hardware, OS/runtime, viewport/drawing buffer, display refresh rate, quality and visual settings, window visibility, warm-up and measurement duration. Compare under matching conditions; changes to those inputs need a new baseline.

Build and package Dev first using the commands in [README](../README.md#develop-and-verify). Then run:

```sh
npm run benchmark -- --quick --visible --hardware reference-machine
npm run benchmark:compare -- /external/baseline.json /external/candidate.json
```

Benchmark recording runs the existing seeded opening loop at 2560 × 1440 logical pixels, with 2 seconds of warm-up and 10 seconds of measurement. `--warmup-ms` (0–30000) and `--duration-ms` (1000–60000) select bounded durations. The first frame gap crossing the measurement boundary is discarded. The record includes loaded package commit/dirty identity and checksum digest, package asset identity, current source identity, OS/CPU name, GPU, Electron/Chromium/Node versions, backend flags, actual visibility, display frequency, viewport/buffer/DPR and visual settings. Rebuild when the selected asset pack differs. This is a Sandbox workload; it does not establish packaged Game performance across all content.

The command prints and retains `benchmark.json` in the bounded external cache without requesting screenshots. Comparison validates records, rejects changed environment/settings/assets/warm-up/scenario or unavailable GPU/refresh observations, and reports p95/p99 frame gaps plus hitch (≥50 ms) and stall (≥100 ms) rates per 30 seconds of sampled gaps. Requested measurement lengths may differ; rates use actual sampled duration. Source/build identities may differ because those are the changes being compared. Empty, short or invalid samples fail rather than reporting zero hitches. Changes to the benchmark policy need a new scenario version and baseline. There is no automatic performance pass threshold.

Identify the affected phase or hitch and repeat observations to distinguish improvement from run-to-run variation. Check relevant neighboring scenarios for regressions. Report setup time separately from measured play, and compare hitch rates over equivalent durations. The packaged 2560 x 1440 / 60 FPS goal in [design intent](game-design.md#presentation-and-delivery-defaults) requires named reference hardware; hidden/software-runner results do not establish it.

Preserve visual fidelity, particle counts, animation timing and sound behavior during optimization. Compare actual rendered pixels under identical inputs for rendering changes; reuse deterministic geometry or draw-output checks where they protect the changed calculation. Builds and faster frame measurements do not establish presentation parity. State when parity or comparable measurements are unavailable, and keep evidence in bounded external diagnostics rather than Git. Use `--capture` only for an explicit visual investigation.

## Packaged player journey measurements

Build and package Game, then run `npm run benchmark:game -- --visible --hardware reference-machine`. This launches a fresh player process with an isolated profile and uses the existing shipping-control smoke journey. It records approach, graveyard combat, area traversal/revisit, chapel combat, checkpoint save/load and death/retry segments. The player retains no developer inspection API. The existing final settings/reload checks still run after measurement completes; only a successful full command establishes journey verification.

The default benchmark uses a 2560 × 1440 window and 100% render scale; `--render-scale 0.75` or `--render-scale 0.5` selects the player's existing alternatives. Records contain actual canvas/buffer dimensions and settings, loaded artifact checksums, the exact starting authored-input digest and asset pin, environment observations, initial checkpoint identity, recorded input sequences and per-phase frame gaps. A package that does not match current authored inputs is rejected before measurement. No warm-up is performed: each invocation observes first use in a new process. Launch-to-ready and renderer-ready observations include harness scheduling; they do not prove cold OS/disk caches.

Use `npm run benchmark:compare -- /external/baseline.json /external/candidate.json` for either Sandbox or Game records. Game comparisons require the same environment, initial checkpoint, completed phases and recorded inputs. The combat driver adapts to observed state; differing inputs invalidate comparison rather than making an easier journey look faster. Each segment needs at least 30 valid frame gaps; short phases retain a bounded sampling tail to reach that minimum. Boundaries discard cross-phase gaps. Measurements include the driver's normal pause/save observations and automation waits; they are a repeatable harness workload, not uninterrupted player cadence. Inspect phase results separately; startup and gameplay remain separate measurements.

Failed or incomplete journeys retain bounded diagnostics and cannot produce valid complete comparison records. Software/hidden observations are diagnostic evidence; the reference-hardware performance goal still requires visible measurements. Frame callbacks cannot establish GPU present timing or presentation parity. Audio needs an in-game listening pass once implemented. Keep needed records externally before cache eviction.
