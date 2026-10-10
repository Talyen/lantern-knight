# Development

This is an early prototype. Prefer a short edit–play–check loop. Scenes, assets, internal interfaces and development checkpoints can change; we have no player compatibility commitment.

## Start and iterate

Use Node 24.18.0 and npm 11.16.0, then `npm ci` and `npm run dev`. One Vite server serves Game, Dev Preview and the scene editor. Developer navigation links connect these views. Dev Preview uses one toolbar and floating inspector for independent outdoor/interior/system fixtures, animation, visuals/effects, inspection and diagnostics; advanced controls remain collapsed until needed.

`npm run dev:preview` starts Dev Preview and opens `/sandbox.html` in Safari on macOS. It reuses a server only after checking checkout, asset identity and authoring scope. Reusing a server opens Safari and returns to the shell; when starting a server, Ctrl+C closes only that server. Use `npm run dev:preview -- --port 5175` to select another port. The personal `lantern-dev` shell command runs this from the primary checkout, from any directory.

`npm run desktop:dev` starts the same server and watches Electron main/preload bundles. Renderer edits reload through Vite; main/preload edits restart the owned Electron process. `-- --game` opens Game with runtime assets; the default developer views use authoring assets. It does not build or package the application first. Close the command to release its server and asset lease.

Lantern defaults to port 5174, including direct Vite launches. Use `-- --port 5175` for a browser worktree, or set `LANTERN_PREVIEW_PORT=5175` for browser and desktop commands. Ports are strict: an occupied port is never taken from another checkout.

Development selects a checkout-local preparation when available, otherwise the immutable pin. `npm run dev -- --pinned` deliberately uses the pin. Assets are shared through an external bounded cache, so new worktrees do not copy artwork or need the source library.

`npm run build` compiles Game for the browser; `-- --dev` compiles the authoring views. Both consume pinned assets unless `-- --local` selects checkout-local preparation. Web builds do not compile Electron. `npm run package` composes the matching web and Electron builds for native delivery; use `-- --local` there for a native prototype with local assets.

## Verify an edit

Run an exact suite while editing: `npm test -- tests/unit/hero-actions.test.ts`. `npm run test:watch` keeps fast pure testing live. After edits stabilize, run `npm run check` once. Full pure coverage uses `npm test -- --full`; slow/integration checks run in CI by default. For targeted local diagnosis or validation, state the reason and run the smallest relevant scope, such as `npm run test:browser -- editor`. `-- --ui` opens Playwright's interactive workflow. Follow [test value](verification.md#test-value) before adding coverage; zero new tests may be sufficient.

[Verification](verification.md) owns test tiers and CI. [Architecture](architecture.md) explains behavior owners. [Assets](assets.md) owns preparing and sharing artwork. Use the [scene editor](developer-tools.md#scene-editor) for composition; design advice does not block valid experiments.

## Review and collaboration

Runtime owners live in `src/core/`, `src/content/`, `src/assets/`, `src/presentation/` and `src/platform/`. Shared application and DOM helpers stay at the `src/` root. Developer screens keep their entry point and screen-specific helpers together in `src/editor/` and `src/sandbox/`; their root HTML pages load each folder's `main.ts`. The former Effects page redirects to Sandbox. Authored inputs live in `authoring/`, asset delivery recipes and pins in `assets/`, and preserved visual references in `references/`.

Tool commands parse arguments and call owned workflows. Preview sessions hold one server/asset workspace, and builds use explicit Game/Authoring profiles. Commands live at the root of `tools/`; callable asset preparation operations live in `tools/assets/prepare/`, replay and benchmark helpers in `tools/diagnostics/`, and native rendering scenarios in `tools/smoke/`. Asset tests, including their Python fixtures, live together in `tests/assets/`. Preparation recipe paths are relative to `tools/`; moving a preparation script invalidates its cached preparation identity without changing the published asset pin.

Inspect `git status`, `git diff --stat` and the relevant diff, including new files. Preserve unrelated edits. Use worktrees for independent or concurrent editing, and agree ownership of shared contracts. Small sequential edits need no task registration, snapshot database or passing-evidence receipt. [Task coordination](task-coordination.md) describes integration and commit authorization.

Before concurrent edits, verify the checkout and worktree list. Each task edits and checks in its own worktree with local dependencies and a distinct preview port. Message other chats only for a concrete dependency, overlapping scope, shared contract decision or integration handoff. Finish isolated verification before handing changes to the single current `main` integration owner. Resource locks handle routine GPU and asset contention.

Keep implementation choices local. Add interfaces only when they express a real consumer or resource lifetime. Delete superseded paths and update their documentation in the same change.
