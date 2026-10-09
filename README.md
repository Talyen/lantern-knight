# Lantern Knight

An early sword-and-lantern prototype with Graveyard Approach and Ruined Chapel. Scenes and assets are actively changing. Game and developer views share simulation, rendering and session lifecycles; production Game builds exclude developer screens.

## Develop and verify

Use Node 24.18.0 and npm 11.16.0:

```sh
npm ci
npm run dev
```

One server provides Game, Sandbox, scene editor and Effects Playground. `npm run desktop:dev` adds live Electron development without a production build. WASD moves, mouse aims, LMB uses the sword, RMB uses the lantern, Shift dodges and Escape pauses.

Run `npm test -- tests/unit/hero-actions.test.ts` while editing, or `npm run test:watch`. Finish ordinary edits with `npm run check`; use `npm run test:browser -- scene` or `editor` for changed browser behavior. Checks execute fresh and print actual timings.

Pinned prepared assets are obtained automatically and cached externally; source artwork is unnecessary for ordinary development and CI. Artwork iteration uses `npm run assets:prepare -- --ids <asset-id>`. Publication is explicit. Prototype checkpoints use a new namespace and may reset after incompatible changes.

## Documentation

| Need | Guide |
| --- | --- |
| Daily iteration and collaboration | [Development](docs/development.md), [Contributing](CONTRIBUTING.md) |
| Owners and changing behavior | [Architecture](docs/architecture.md) |
| Artwork preparation and sharing | [Assets](docs/assets.md), [source recovery](docs/source-recovery.md) |
| Tests, CI and diagnostics | [Verification](docs/verification.md), [handoff](docs/handoff.md) |
| Scene tools and visual guidance | [Scene editor](docs/scene-editor.md), [scene design](docs/scene-design.md) |
| Lighting and effects | [Lighting](docs/lighting-lab.md), [Effects Playground](docs/effects-playground.md) |
| Intent and future work | [Game design](docs/game-design.md), [roadmap](docs/roadmap.md), [audio](docs/audio.md) |
| Reproduction and explicit delivery | [Session replay](docs/session-replay.md), [release](docs/release.md) |
| Requested investigations | [Audits](docs/audits/README.md) |

[Agent guidance](AGENTS.md) owns source preservation and skill routing. `package.json` lists the command surface.
