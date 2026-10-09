# Milestone delivery

Packaging is an explicit milestone operation, separate from ordinary iteration and asset sharing. There are no players or supported public releases yet.

Run `npm run check:ci`, runtime asset validation and browser scenarios, then `npm run package -- --platform mac` or `win`. Packaging builds the web and Electron outputs once, then records and verifies their combined desktop identity. `--prebuilt` deliberately selects existing verified desktop outputs; a browser-only build is insufficient. `--dev` optionally packages the developer tools. Run `npm run test:desktop` against the resulting Game package on its actual host.

Packages retain source commit, asset identity and output checksums. Native jobs build directly from the checked-out commit and pin; no cross-platform build-restoration protocol is needed. Follow hosted CI to final conclusions only after an authorized push. Local macOS validation does not establish Windows or hosted success.

Current output is an unsigned unpacked macOS arm64/Windows x64 application. Public signing, notarization, installers, licenses/notices and a distribution channel are future requirements to choose when an actual release is requested. [Assets](assets.md) owns explicit pin publication; [verification](verification.md) owns checks and evidence.
