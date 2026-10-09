# Development

This is an early prototype. Prefer a short edit–play–check loop. Scenes, assets, internal interfaces and development checkpoints can change; we have no player compatibility commitment.

## Start and iterate

Use Node 24.18.0 and npm 11.16.0, then `npm ci` and `npm run dev`. One Vite server serves Game, Sandbox, the scene editor and Effects Playground. Developer navigation links connect these views. Sandbox contains animation, calibration, occlusion and Lighting & Look modes.

`npm run desktop:dev` starts the same server and watches Electron main/preload bundles. Renderer edits reload through Vite; main/preload edits restart the owned Electron process. It does not build or package the application first. Close the command to release its server and asset lease.

Lantern defaults to port 5174, including direct Vite launches. Use `-- --port 5175` for a browser worktree, or set `LANTERN_PREVIEW_PORT=5175` for browser and desktop commands. Ports are strict: an occupied port is never taken from another checkout.

Development selects a checkout-local preparation when available, otherwise the immutable pin. `npm run dev -- --pinned` deliberately uses the pin. Assets are shared through an external bounded cache, so new worktrees do not copy artwork or need the source library.

`npm run build` compiles Game for the browser; `-- --dev` compiles the authoring views. Both consume pinned assets unless `-- --local` selects checkout-local preparation. Web builds do not compile Electron. `npm run package` composes the matching web and Electron builds for native delivery; use `-- --local` there for a native prototype with local assets.

## Verify an edit

Run an exact suite while editing: `npm test -- tests/unit/hero-actions.test.ts`. `npm run test:watch` keeps pure testing live. After edits stabilize, run `npm run check` once. Changed browser behavior should also run its relevant scenario, such as `npm run test:browser -- scene` or `npm run test:browser -- editor`. `-- --ui` opens Playwright's interactive test workflow.

[Verification](verification.md) owns test tiers and CI. [Architecture](architecture.md) explains behavior owners. [Assets](assets.md) owns preparing and sharing artwork. Use the [scene editor](developer-tools.md#scene-editor) for composition; design advice does not block valid experiments.

## Review and collaboration

Inspect `git status`, `git diff --stat` and the relevant diff, including new files. Preserve unrelated edits. Use worktrees for independent or concurrent editing, and agree ownership of shared contracts. Small sequential edits need no task registration, snapshot database or passing-evidence receipt. [Task coordination](task-coordination.md) describes integration and commit authorization.

Keep implementation choices local. Add interfaces only when they express a real consumer or resource lifetime. Delete superseded paths and update their documentation in the same change.
