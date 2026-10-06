# Lantern current decisions — implementation v0.3

Updated 6 October 2026 from the owner's confirmed design and approved full-game systems foundation plan. Art production and encounter polish remain deferred without a promised delivery date. The original PDF is preserved byte-for-byte (SHA-256 `cdd7ca1e1b9213dce85dc258992472fd03c67f48723ce76df08e7df3098758f8`). The owner manages all agent assignments.

| Decision | Status and authority | Implementation consequence |
|---|---|---|
| Exact original C / RUST hero | Locked by owner; `image(3).png`, Library `libfile_0da5071239448191b6962495ce1e0164` | No redesign, recolor, refinement, crop or regeneration. Original face, rust coat/patches, two belts, vest, props, right wrap and left bracer remain canon. The standalone original is not currently available locally; art production is deferred by the owner. PDF figure 2 is a visual guide, not a byte-equivalent PNG substitute. |
| Clean INK | Locked | Earlier low-poly/crimson engineering renders are placeholders only. Production must prove faithful linework, shapes and values from one controlled canonical source before multi-view motion expansion. No rejected theme family is adopted. |
| Camera | Selected; no further camera-selection gate | Orthographic 35.264389682754654° elevation, 45° azimuth, 13 m initial vertical span, zoom=1. Translation-only follow; optional 11–15 m framing. Camera contract/bake v2, full basis/matrices in calibration fixture. |
| Hero scale / source density | Provisional production measurements | A 1.8 m ruler projects to 162.8 px at 1440p/span13. Existing 192 px/projected-unit, 384×432, foot (192,348) remain diagnostic registration. Real art must validate footprint, silhouette and filtering. |
| Combat | Confirmed behavior, provisional numerical tuning | Three buffered sword stages and mouse-directed arcs; designated recovery dash cancel; brief invulnerability; aimed short-cone flare/stagger/cooldown; travel-facing locomotion and aim-facing actions. No stamina or torso/strafe compositor. |
| Spaces / death | Confirmed | Court and Upper Landing linked through a cleared-room gate; one 0–0.45 m ramp/landing height query. Death holds the final pose, then resets the current encounter once in fixed simulation. New generation rejects old events/commands/actor references. |
| Art work | Explicitly deferred by owner | Reuse existing PNGs unchanged. Stages 02/03 have distinct gameplay but reuse first-swing placeholder drawings. Enemy clip namespaces preserve their placeholders when hero art is replaced. No new hero or final motion exports are part of this checkpoint. |
| Desktop / targets | Confirmed boundaries | three.js + Electron, Windows primary, macOS local validation. Windows directory creation is packaging evidence, not a runtime pass or 1440p certification. |

| Content authoring | Owner selected typed TypeScript | Stable area/spawn/actor IDs, declared bounds/surfaces/entries/exits and configurable melee profiles. Court and Landing remain regression fixtures; a third systems fixture proves variable counts, health and axes. |
| Revisits / death | Owner confirmed | Preserve visited-area enemy health/positions and clears. Death resets only the current area and player baseline, preserving other area records. |
| Combat persistence | Owner confirmed | Carry player health and remaining cooldown ticks across transitions/save/load. Clear actions, input buffers and enemy temporary statuses; inactive time does not advance cooldowns. |
| Saving / startup | Owner confirmed | Manual and boundary autosaves share one slot. Startup does not restore automatically. Existing saves remain write-protected until successful Load or confirmed New Game; unreadable/newer/unknown-content saves remain preserved. |
| Enemy behavior | Owner selected configurable melee | Two numerical profiles reuse the existing melee behavior and placeholders. Ranged combat remains outside this pass. |
| Events / assets | Approved systems plan | Consume immutable fixed-step events, deliver runtime animation notifications with generation/disposal lifetimes, and bind actors to independently registered manifests sharing verified texture content. |
| CI | Owner selected desktop on main | Lightweight PR/main checks; packaged macOS arm64 and Windows x64 smoke on main/manual dispatch, reusing the same-run verified build artifact. Shipping hardware performance stays separate. |

## Changes propagated

Camera/configuration, asset schema and existing placeholder manifests were reconciled in place. The tiny v1 angle rounding difference is explicitly revalidated: maximum estimated error under 0.000001 source pixels; old PNG bytes are unchanged. Significant bake changes require new exports. The 12→13 m change is presentation framing, not a disguised sprite rescale. Historical bake metadata remains attached to old engineering content and prevents production promotion.

Asset format stays v2 and camera/bake stay v2. Game saves are independently v3 with v0/v1/v2 migration; settings stay v2 with v1 migration. Game payloads are bounded to 1 MiB and settings to 16 KiB. Gameplay tuning, terrain, input, animation, renderer, desktop tests and current documentation share these decisions. Earlier documents and evidence are preserved under `docs/history/`, `evidence/history/` and `references/` and are not active requirements where they conflict.

## Deferred art input

When art production resumes, add the exact unchanged standalone `image(3).png` under `references/canon/`, and reviewed real runtime frames/source metadata under `staging/`. A reference image is not an animation set. Preserve the original PNG, register its digest, verify the canonical source's Clean INK look and representative front/three-quarter, side and back motion before mass export. Do not adapt the historical engineering rig into a purported approved hero by changing its palette.
