# Foundation handoff — 6 October 2026

## Delivered checkpoint

Playable encounter, calibration room, animation laboratory and occlusion fixtures share the same camera/asset runtime. The macOS arm64 application is at `release/mac-arm64/Lantern Knight.app`. Source and exact commands are in [README](../README.md).

| Milestone | Result | Evidence / boundary |
|---|---|---|
| A — boot + calibration | Passed | strict TypeScript, pinned packages/lockfile, actual 3D calibration rig, contract/basis/matrices, input and valid/invalid fixtures |
| B — asset / animation lab | Passed | original PNG import, deterministic atlas compiler, semantic lint, trim/UV math, independent actors, scrub/step/speed/notify inspection |
| C — first controlled sample | Proxy sample passed; expansion gated | Blender 5.2.2 executed; editable source/rig, 8 d45 walk + 8 sword drawings, exact compiled assets in engine, contact/GIF/turnaround evidence. Final design/camera/sample approval remains pending |
| D — playable micro-slice | Passed as proxy gameplay | 3 wardens, aim/move/sword/dodge/flare, damage/death/reset, telegraphs/HUD, simple 3D occlusion structures and contact shadows |
| E — desktop handoff | Passed for available macOS | packaged offline boot, actual preload/IPC/save/relaunch smoke, focused tests and bounded performance/lifetime pass. Windows runtime, signing and selected shipping hardware are not verified |

This does not promote any proxy to final art or certify Windows performance. Remaining art is correctly rejected by the production validator unless the explicitly named development-content flag is enabled. All earlier failed test/harness attempts were repaired; current records in `evidence/desktop-smoke.json` and `performance.json` describe the final checks. The first window-clamped benchmark is separately retained and rejected for target-resolution claims.

## Validation ledger

- **Passed:** `npm run typecheck`; 14 focused test groups via `npm test`; development asset validation; deterministic small compiler output; invalid fixtures; trim/ground project/unproject math at two aspects; direction wrap/tie/hysteresis; skipped/loop notify and silent seek; seeded simulation replay across 30/144 Hz render cadence; hit-once, cooldown, dodge, interruption/death; loader sharing/cancel/retry; save migration/recovery/newer version refusal; IPC/path boundaries.
- **Passed:** Blender lossless export and re-export with named rigid parts, fixed root/handedness, contact/attack phases and visible bounds. Proxy contact sheets reviewed. This is a technical sample, not artist approval.
- **Passed:** browser dev verification with agent-browser: page loads, controls render, no console errors.
- **Passed:** unsigned macOS arm64 packaging and 19 packaged desktop checks: input/actions, pause, resize, independent atlas frames, actual Electron save→exit→relaunch→load, eight resets with stable texture/geometry counts, interrupted-load suppression, death-frame completion and single-count clear progression, exact ground anchoring, full hero framing at room corners and sRGB swatch parity over dark/light backgrounds.
- **Expected rejection:** `npm run assets:production` rejects proxy/diagnostic frames and unapproved camera. No production asset-validation pass is claimed.
- **Passed:** `npm audit --omit=dev`: zero runtime dependency advisories. Full npm audit reports eight moderate transitive development-tool findings, originating from optional packager proxy logging's `sprintf-js` dependency. Registry stable latest is 1.1.3 with no patched stable release available at the check; no beta or forced downgrade was introduced. See `evidence/npm-audit.json`. This is another reason to treat packaging as a development checkpoint.
- **Not run:** Windows runtime smoke or named Windows 1440p hardware test; no Windows host available. The x64 directory build at `release/win-unpacked/Lantern Knight.exe` was produced successfully; this is packaging evidence only.
- **Not run:** signing/notarization, installers/distribution credentials, auto-update, final production art, full audio integration, GPU timer-query measurement or universal cross-platform determinism certification.

See [performance report](performance.md) for exact hardware, actual buffer dimensions, samples, resource categories and limitations. Framework/package versions are pinned in `package.json`, `package-lock.json` and [versions.json](versions.json); runtime Chromium/Electron versions are captured by the packaged tests.

## Review artifacts

- `evidence/calibration-16x9.png`, `calibration-4x3.png`, `camera-30.png`, `camera-45.png`: same real 3D proxy; provisional camera labeled in UI; source bake remains v1.
- `evidence/turnaround.png`: eight still headings with consistent anatomical equipment. Technical proxy, no approved male character design.
- `evidence/walk-contact.png`, `attack_sword_01-contact.png`: every exported drawing and its authored hold.
- `evidence/walk-preview.gif`, `attack_sword_01-preview.gif`: looping original exports.
- `evidence/animation-walk.png`, `animation-attack.png`: exact compiled proxy frames in the actual lab, with trim/foot/socket overlays and timeline.
- `evidence/occlusion-normal.png`, `occlusion-debug.png`, `occlusion-actor-crossing.png`, `occlusion-tree.png`, `occlusion-wall-corner.png`, `occlusion-foreground.png`: current bounded depth/geometry/fade policy. These are practical slice fixtures, not general per-pixel depth from flat sprites.
- `evidence/encounter-1440p.png`, `stress-1440p.png`: benchmark fixtures at the actual recorded drawing buffer.

## Small next assignments, for you to dispatch

1. **Camera and male design decision.** Owner: art direction; inputs: calibration/turnaround/sample artifacts. Choose or revise canonical angles, 12-unit framing, 1.8-unit scale, silhouette/material direction and hands. Acceptance: recorded approval plus versioned contract; changed angles trigger re-export. Runtime groundwork need not be rebuilt.
2. **Hero animation kit.** Owner: character artist/export tooling; own `authoring/`, reviewed `staging/` and metadata only. After the above approval and first-sample review, replace diagnostics with eight-view walk/sword first, then idle/dodge/flare/hit/death. Acceptance: no required placeholder or mirrored gear, runtime production lint, stable anchor/socket/timing and native/game-size contact review. Preserve simulation authority.
3. **Environment kit.** Owner: environment artist; own room geometry/visual definitions and staging props. Deliver floor, pillar, corner, split crown/foreground and separate collision footprints. Acceptance: all existing overlap fixture journeys remain readable, sRGB/alpha edges match and resource residency stays budgeted.
4. **Encounter and Windows hardware verification.** Owner: gameplay/platform engineer; own gameplay tuning and Windows test harness. Refine this single encounter/flare, then run packaged Windows input/save/resize/lifetime and 1440p benchmark on a named GPU/display. Acceptance: recorded final platform result, frame-time distribution and honest hardware/budget limits before content expansion.

**Most important next decision:** approve or revise the provisional camera/scale and lighter male proxy turnaround plus d45 walk/sword sample. Eight-view final-art expansion remains paused at that explicit gate.
