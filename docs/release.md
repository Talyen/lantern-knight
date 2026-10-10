# Milestone delivery

Packaging is an explicit milestone operation, separate from ordinary iteration and asset sharing. There are no players or supported public releases yet.

Validate the milestone with the source, asset and browser checks. For local milestone verification, set `CI=true` in the command environment so development-preview browser checks use the shared pin and start their own server. Choose an unused preview port through `LANTERN_PREVIEW_PORT`; see [Development](development.md) for port ownership.

```sh
npm run check:ci
npm run test:assets
npm run assets:check
npm run build
npm run test:browser -- game --built
npm run test:browser -- scene editor effects
```

Install Chromium once with `npx playwright install chromium` if local browser checks need it. The hosted workflow installs its browser and system dependencies explicitly. [Verification](verification.md) explains what each tier covers.

On the target host, run `npm run package -- --platform mac` or `npm run package -- --platform win`, then `npm run test:desktop` against the resulting Game package. Game output is `release/mac-arm64/Lantern Knight.app` on macOS or `release/win-unpacked/Lantern Knight.exe` on Windows.

Packaging builds the web and Electron outputs once, then records and verifies their combined desktop identity. `--prebuilt` deliberately selects existing verified desktop outputs; a browser-only build is insufficient. It cannot be combined with `--local`; select local assets when creating the build. `--dev` optionally packages Lantern Knight Dev under `release-dev/` and is separate from the Game package required by desktop tests.

Packages retain source commit, asset identity and output checksums. Native jobs build directly from the checked-out commit and pin; no cross-platform build-restoration protocol is needed. Follow hosted CI to final conclusions only after an authorized push. Local macOS validation does not establish Windows or hosted success.

Current output is an unsigned unpacked macOS arm64/Windows x64 application. Public signing, notarization, installers, licenses/notices and a distribution channel are future requirements to choose when an actual release is requested. [Assets](assets.md) owns explicit pin publication; [verification](verification.md) owns checks and evidence.
