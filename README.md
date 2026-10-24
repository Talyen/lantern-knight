# Lantern Knight

An early sword-and-lantern prototype with a playable orchard opening, connected clearing, forge and chapel destinations and independently authored scenes. Game and developer views share simulation, rendering and session lifecycles; production Game builds exclude developer screens.

## Develop and verify

Use Node 24.22.1 and npm 11.16.0:

```sh
npm ci
npm run dev
```

WASD moves, mouse aims, LMB uses the sword, RMB uses the lantern, Shift dodges, E interacts, I opens inventory, Q uses a health potion and Escape pauses. `npm run desktop:dev` adds live Electron development. Original sources and the prepared scene/Game catalog are stored in `asset-data/`. Ordinary development assembles owned assets locally; new artwork enters through explicit `assets:import`.

Game opens in the abandoned orchard, with separate paths to the forest clearing and ruined forge courtyard. The forge’s northern street leads to Desecrated Chapel; exploration and loot have no enemy-clearance requirements. To playtest other authored content, open `/editor.html`, choose a saved scene through Scene → Open scene, click Open, then Play. Drafts whose ground is absent from the pin need [local artwork preparation](docs/assets.md#local-preparation-review). `/sandbox.html` opens the independent Dev Preview fixtures.

Follow [Development](docs/development.md) for the edit–play–check loop, [Verification](docs/verification.md) for check selection, and [task coordination](docs/task-coordination.md) for integration.

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
| Audition and tune sound | [Sound design](docs/sound-design.md), [audio preparation](docs/assets.md#audio-preparation) |
| Understand design and priorities | [Game design](docs/game-design.md), [roadmap](docs/roadmap.md) |
| Package a milestone | [Delivery](docs/release.md) |
| Run a requested investigation | [Audits](docs/audits/README.md) |

[Agent guidance](AGENTS.md) owns source preservation and [skill routing](.agents/skills/README.md). [Canonical references](references/canon/README.md) identify the hero and [Clean INK style](references/canon/clean-ink-style-sources.md). `package.json` lists available commands.

Visual work: [reference set](references/visual/README.md), [product copy](docs/product-copy.md), and [UI design study](docs/ui-polish.md).
