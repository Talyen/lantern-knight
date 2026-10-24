# Rust adventurer: slightly down-right illustrated walk prototype

Status: user-review test. One approximate, slightly down-right walk only. Not production-approved, calibrated d135, or certified engine-ready.

## What is here
- 8 transparent PNG frames, each 512 x 640, at their native generated pixel scale
- 8 raw extracted figures, preserving original alpha and ~466–505 px opaque figure heights
- 4 x 2 PNG atlas, 8 px transparent gutter around each frame
- timing_and_registration.json with fixed root, atlas rectangles, per-pose registration, and exact 60 Hz frame holds
- Clean and ground-guide MP4/GIF previews at 1.0 s and 0.8 s per cycle; each shows a large figure and consistent 163 px / 122 px reference-height reads
- Native generated sheet, full final prompt, original identity reference and reference guides

## Playback
Recommended first review: preview/walk_100s.mp4. The exact eight drawings are held for [9,8,7,6,9,8,7,6] ticks at 60 Hz, totaling 1.0 seconds. The brisk alternative uses [7,6,6,5,7,6,6,5], totaling 0.8 seconds. GIF delays are rounded to centiseconds; MP4 timing is the exact integer-tick schedule. No optical flow, tweening, rig deformation, or extra generated in-between frames.

## Import
All sprite frames have a fixed 512 x 640 canvas and root pivot (256,572), measured from top left. For bottom-origin engines use pivot (256,68), or normalized (0.5,0.10625) from bottom left. Atlas rectangles exclude the 8 px gutters. Keep equal sprite scale for every frame.

Prototype registration translates each whole drawing only. Horizontal alignment uses a manually identified pelvis center. Vertical alignment places the selected weight-bearing heel/sole/toe onto one of two constant, gently sloped drawn-ground tracks. There is no per-frame resizing, body warping, optical interpolation, or imposed head bob. The guides are an approximate 2D import aid, not calibrated 3D geometry; inspect the ground-guide preview before integration. Markers are present only in previews.

## Heading and floor limitation

The requested nominal d135 heading should project horizontally toward screen right under the requested camera. These drawings instead imply a slightly down-right travel/footing direction. The review registration uses an approximate +0.18 y/x ground slope (about 10.2 degrees down-right), explicitly not exact d135 calibration. Frames 04 and 08 place the forward reaching boot lower on screen than the rear supporting toe; aligning that support to horizontal foot tracks makes the reaching boot intersect the expected floor. The included horizontal_d135_floor_check previews expose this unresolved mismatch. The 35.2643897-degree camera elevation / 45-degree azimuth remain prompted illustration targets, not measured geometry. No foot-plant certification is claimed.

## Remaining limitations
- Stride opens abruptly between passing and up poses (03→04 and 07→08)
- Frame 06's rear lantern and frame 07's sword still vary in apparent size
- Some cloth, body and item details vary between drawings
- Ground contact and opposite-foot clearance are drawn approximations; the ground-guide previews expose remaining asymmetry
- Camera settings are the requested illustration target, not a measured 3D projection

This is AI-generated frame-by-frame illustration. It is not a claim that a human artist hand-drew the frames. The prompt included “Sunburst 2.5 (gpt-image-2.5-sunburst)” as requested, but the generation tool did not expose or verify the actual backend model.

No other headings, attacks or animations are included; approval of this walk is the next gate.
