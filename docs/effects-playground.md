# Effects Playground

The Dev-only playground is an independent scene for comparing living lights, smoke/embers, rain, surface normals, relief, wind, atmosphere, palette, bloom, wetness, outlines, contact grounding and shafts. It supports quiet/richer treatments, an all-off baseline that preserves the selected options, pause, replay and return to Sandbox.

Game packages exclude the playground and its developer fixtures. Production visual options use persistent settings; the playground changes only its disposable session.

Shared ambience, weather scheduling and materials are prepared through `assets:prepare` and distributed in the pinned pack. `smoke:effects` verifies rendered differences, baseline restoration, playback, stable resources and routing. `smoke:visual-options` checks player preferences; `smoke:visual-scenes` checks production weather and area replacement. Details are retained for failures or explicit `--capture` investigations.
