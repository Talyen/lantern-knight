# Lantern Knight

The opening has two playable areas: Graveyard Approach (one skeleton) and Ruined Chapel (two). Game and Dev share the renderer, combat, session and persistence lifecycle. Dev additionally provides Sandbox, animation/calibration/lighting labs and the Effects Playground. Player packages exclude developer screens and inspection APIs.

## Develop and verify

Use Node 24.18.0 and npm 11.16.0. Dependencies are pinned.

```sh
npm ci
npm run dev
npm test
npm run assets:check
npm run repo:check
npm run build
npm run build:dev
npm run package:mac:prebuilt
npm run package:dev:mac:prebuilt
npm run smoke:game
npm run smoke:sandbox -- --ci
npm run smoke:crypt -- --quick
```

Development, tests and builds automatically obtain the exact prepared asset revision pinned in `assets/lock.json`. Verified assets live in the operating system cache outside the checkout and are reusable offline. Code-only work and hosted CI do not need the source Asset Library.

`npm run desktop` starts Game; `npm run desktop:dev` starts Sandbox; `npm run desktop:preview` starts Dev Game Preview; `npm run desktop:effects` starts the playground. Windows packaging uses the corresponding `package:win:prebuilt` and `package:dev:win:prebuilt` commands.

## Artwork workflow

Originals remain in the shared, iCloud-backed Asset Library under Documents. On an art-authoring machine, `npm run assets:prepare` creates and validates selected outputs. `npm run assets:publish` publishes the verified shared pack through GitHub Releases and updates the pin after checking the public download. These are explicit authoring operations; ordinary builds never regenerate artwork.

The source library can be reorganized: sources are recovered automatically by recorded hashes. Canonical reference images and Clean INK prompts remain unchanged. [Asset ownership](docs/assets.md) and [source recovery](docs/source-recovery.md) describe the contracts.

## Retention and diagnostics

The external disposable cache has a 4 GiB budget. Unused entries are evicted automatically; active commands are protected. `npm run assets:clean` explicitly deletes published packs no current checkout, remote main, open PR or supported release needs. Supported game tags are listed in `assets/supported.json`.

Successful checks print concise summaries and discard routine captures. Failures retain bounded diagnostics; `--capture` explicitly requests screenshots/video exports. Smoke windows are hidden and non-focusable by default; `--visible` enables a normal window. Hidden checks do not certify visible display pacing.

Major accomplishments and upcoming work are tracked in the [roadmap](docs/roadmap.md). Current game behavior, architecture and developer tools are documented in [design intent](docs/game-design.md), [foundation](docs/foundation.md), [lighting](docs/lighting-lab.md) and [effects](docs/effects-playground.md).

For a locally prepared replacement, append `--local` to asset-backed tests, checks, builds and smoke commands. This verifies the unpublished preparation without changing the shared pack pin. `npm run smoke:animation -- --local --capture` explicitly retains bounded current-kit comparison evidence.
