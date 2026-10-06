# Lantern Knight foundation

A runnable three.js / Electron micro-slice with a shared asset and animation lab, editable Blender proxy, deterministic gameplay, and an offline PNG atlas pipeline. This checkpoint intentionally uses **unapproved proxy and diagnostic content**.

## Run

Requires Node **24.18.0** (24.x), npm **11.16.0**, and a WebGL 2 GPU. Generated assets are included; Blender is only needed to edit/re-export the sample.

```sh
npm ci
npm run dev              # browser; use the URL Vite prints
npm run desktop          # build then launch the secured local Electron app
npm run typecheck
npm test
npm run assets:validate
npm run package:mac      # unsigned arm64 app directory
npm run package:win      # x64 app directory; requires Windows runtime verification
npm run smoke            # checks the packaged macOS app, including relaunch
npm run benchmark        # 5 s warm-up, 60 s encounter + 15 s modest stress
```

If npm's install-script policy skips Electron's binary download, run `node node_modules/electron/install.js` after `npm ci`. No security setting in the game is weakened for browser development. `npm run desktop` loads built local content with the custom `lantern://app` protocol; Vite is a separate browser adapter.

**Playable app:** `release/mac-arm64/Lantern Knight.app`. The Windows x64 directory build is `release/win-unpacked/` (copy the whole folder; its `.exe` alone is insufficient). Windows runtime validation remains pending. Open it in Finder, or:

```sh
open 'release/mac-arm64/Lantern Knight.app'
```

WASD is screen-relative. Mouse aims on the ground. LMB attacks, Shift dodges, RMB flares, Escape pauses. Three melee wardens can be defeated; damage, death, reset and checkpoint save/load are implemented. The pause menu controls render scale and saves through Electron's narrow bridge. Game saves preserve position/health and enemy position/health; ongoing actions reset on load. Enemy art is a tinted diagnostic/proxy reuse, not a finished enemy design.

The tabs switch between the encounter, camera calibration, animation inspection and occlusion fixtures. The lab exposes clip/direction, pause, step, scrub, speed, canvas/trim/foot/socket overlays, two independent atlas users and crossed-interval notify identities. Scrubbing is silent and cannot affect combat.

## Rebuild the sample

Blender **5.2.2 LTS** was used. On macOS it is detected at `/Applications/Blender.app/Contents/MacOS/Blender`; elsewhere set `LANTERN_BLENDER` to its executable.

```sh
npm run assets:diagnostic
npm run assets:export
npm run assets:compile
npm run assets:inspect
```

`assets:export` builds the editable rig and exports eight d45 walk drawings, eight d45 sword drawings, a proxy turnaround, a calibration GLB and metadata. The compiler consumes those exact original PNGs. `assets:inspect` writes contact sheets and looping GIFs to `evidence/`. Read [the asset workflow](docs/assets.md) before changing the bake contract or replacing frames. The remaining headings and clips stay diagnostic; broad animation production awaits approval.

## Handoff

- [Delivery and check status](docs/handoff.md)
- [Camera, renderer, architecture and tuning](docs/foundation.md)
- [Source-to-runtime workflow and replacement example](docs/assets.md)
- [Performance and memory report](docs/performance.md)
- [Recorded dependency/tool versions](docs/versions.json)
- [Desktop smoke evidence](evidence/desktop-smoke.json)
- [Camera fixture with actual basis/matrices](public/generated/calibration.json)
- [Editable rig](authoring/knight/rig.blend), [walk preview](evidence/walk-preview.gif), [attack preview](evidence/attack_sword_01-preview.gif), [turnaround](evidence/turnaround.png)

The pasted assignment is retained in `references/assignment.txt`. The ZIP's documents remain unchanged under `references/handoff/` as supporting drafts. Their illustrative manifest is not imported as runtime content. The implemented version 1 schema reconciles their labels/handedness/camera conventions while replacing the draft giant-canvas default with footprint-based resolution.

**Next decision:** review camera v1, 1.8-unit hero scale, lighter male proxy turnaround and d45 walk/attack before approving eight-view production. No final art, Windows runtime result, signing, shipping hardware or 120 FPS promise is implied by this checkpoint.
