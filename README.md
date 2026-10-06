# Lantern Knight

A fixed-camera action RPG prototype built with TypeScript, Three.js, Vite, and Electron. The current foundation uses provisional proxy art and a Blender-based sprite authoring pipeline.

## Getting started

Use Node.js `>=24.18.0 <25`.

```sh
npm ci
npm run dev
```

To build and launch the desktop app:

```sh
npm run desktop
```

## Checks and assets

```sh
npm run typecheck
npm test
npm run build
npm run assets:validate
```

Source code lives in `src/` and `electron/`. Asset authoring files are in `authoring/`, asset tooling is in `tools/`, and runtime assets are in `public/generated/`.

See [the design intent](docs/game-design.md) for gameplay targets and [the foundation handoff](references/handoff/START_HERE.txt) for supporting art-production references.
