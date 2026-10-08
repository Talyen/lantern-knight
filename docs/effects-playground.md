# Effects Playground

The Dev-only playground is an independent scene for comparing living lights, smoke/embers, rain, surface normals, relief, wind, atmosphere, palette, bloom, wetness, outlines, contact grounding and shafts. It supports quiet/richer treatments, an all-off baseline that preserves the selected options, pause, replay and return to Sandbox.

Game packages exclude the playground and its developer fixtures. Production visual options use persistent settings; the playground changes only its disposable session.

`assets:prepare` supplies ambience artwork and companion data through the pinned pack. Runtime code owns weather scheduling, shaders and material construction; changes to those behaviors consume the existing pack unless they also change preparation inputs.

`smoke:effects` verifies rendered differences, baseline restoration, playback, stable resources and routing. [Contributing](../CONTRIBUTING.md#e2e-coverage-and-execution-budgets) owns shared and platform coverage. Details are retained for failures or explicit `--capture` investigations.
