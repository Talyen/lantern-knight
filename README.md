# Lantern Knight

An early sword-and-lantern prototype with a playable orchard opening, a forest clearing destination and independently authored scenes. Game and developer views share simulation, rendering and session lifecycles; production Game builds exclude developer screens.

## Develop and verify

Use Node 24.18.0 and npm 11.16.0:

```sh
npm ci
npm run dev
```

WASD moves, mouse aims, LMB uses the sword, RMB uses the lantern, Shift dodges and Escape pauses. `npm run desktop:dev` adds live Electron development. Pinned prepared assets download automatically into an external cache; ordinary development needs no source artwork.

Game opens on an empty floor. To play authored content, open `/editor.html`, choose a saved scene through Scene → Open scene, click Open, then Play. Drafts whose ground is absent from the pin need [local artwork preparation](docs/assets.md#local-preparation-review). `/sandbox.html` opens the independent Dev Preview fixtures.

Follow [Development](docs/development.md) for focused tests, preview ports and the edit–play–check loop. Finish edits with `npm run check`; [Verification](docs/verification.md) explains additional checks for browser, asset and desktop changes.

## Documentation

| Task | Guide |
| --- | --- |
| Set up and iterate | [Development](docs/development.md) |
| Review and integrate changes | [Contributing](CONTRIBUTING.md), [task coordination](docs/task-coordination.md) |
| Understand owners and change contracts | [Architecture](docs/architecture.md) |
| Prepare and share artwork | [Assets](docs/assets.md), [source recovery](docs/source-recovery.md) |
| Run tests or measure performance | [Verification](docs/verification.md), [session replay](docs/session-replay.md) |
| Author and playtest a scene | [Scene editor](docs/developer-tools.md#scene-editor), [saved scenes](authoring/scenes/README.md), [scene design](docs/scene-design.md) |
| Author collision and occlusion in a painting | [Ground interaction](docs/developer-tools.md#ground-interaction), [local model setup](docs/developer-tools.md#local-foreground-selection-setup) |
| Inspect animation, lighting or effects | [Dev Preview](docs/developer-tools.md#dev-preview), [diagnostics](docs/developer-tools.md#checks-and-diagnostics) |
| Understand design and priorities | [Game design](docs/game-design.md), [roadmap](docs/roadmap.md) |
| Package a milestone | [Delivery](docs/release.md) |
| Run a requested investigation | [Audits](docs/audits/README.md) |

[Agent guidance](AGENTS.md) owns source preservation and [skill routing](.agents/skills/README.md). [Canonical references](references/canon/README.md) identify the hero and [Clean INK style](references/canon/clean-ink-style-sources.md). `package.json` lists available commands.
