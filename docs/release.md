# Milestone delivery

Packaging is an explicit milestone operation, separate from ordinary iteration and asset sharing. There are no players or supported public releases yet.

Validate the milestone with the source, asset and browser checks. Complete the [asset-test and browser setup](verification.md#test-selection) first. For local milestone verification, set `CI=true` so development-preview browser checks use the shared pin and start their own server. The macOS/Linux examples below use port 5175; choose an unused port through `LANTERN_PREVIEW_PORT` under [Development](development.md).

```sh
npm run check:ci
npm run test:assets
npm run assets:check
npm run build
CI=true LANTERN_PREVIEW_PORT=5175 npm run test:browser -- game --built
CI=true LANTERN_PREVIEW_PORT=5175 npm run test:browser -- --ci-development --authoring
```

In PowerShell, set `$env:CI = 'true'` and `$env:LANTERN_PREVIEW_PORT = '5175'` before the browser commands and omit their inline environment prefixes. Tier selection includes all development-browser CI suites and optional authoring scenarios. [Authored-scene and opening captures](verification.md#test-selection) remain explicit local reviews. [Verification](verification.md) explains what each tier establishes.

On the target host, run `npm run package -- --platform mac` or `npm run package -- --platform win`, then `npm run test:desktop` against the resulting Game package. Game output is `release/mac-arm64/Lantern Knight.app` on macOS or `release/win-unpacked/Lantern Knight.exe` on Windows.

Packaging builds the web and Electron outputs once, then records and verifies their combined desktop identity. `--prebuilt` deliberately selects existing verified desktop outputs; a browser-only build is insufficient. It cannot be combined with `--local`; select local assets when creating the build. `--dev` optionally packages Lantern Knight Dev under `release-dev/` and is separate from the Game package required by desktop tests.

Packages retain source commit, asset identity and output checksums. Native jobs build directly from the checked-out commit and pin; no cross-platform build-restoration protocol is needed. Follow hosted CI to final conclusions only after an authorized push. Local macOS validation does not establish Windows or hosted success.

Mac Game release packages use [Developer ID signing and Apple notarization](#signed-mac-packages-for-steam) by default. Output remains an unpacked macOS arm64/Windows x64 application; Windows packages are unsigned. Windows signing, installers, licenses/notices and Steam depot delivery remain separate release work. [Assets](assets.md) owns explicit pin publication; [verification](verification.md) owns checks and evidence.

## Opening Windows acceptance

Run on the intended Windows reference PC. Record CPU, GPU and driver, RAM, Windows version, display resolution/refresh rate, package source commit and asset identity. Choose a 2560 × 1440 display mode and verify the actual framebuffer; a browser viewport or macOS cross-build does not qualify. Reference hardware remains unnamed until supplied and exercised.

Build with `npm run package -- --platform win`, then run `npm run test:desktop`. Follow the [opening playtest](verification.md#opening-playtest) in the packaged Game with real input, both kit choices, death/retry and process restart after saving. Check audible playback, focus/pause behavior and the return to Orchard Campfire.

For pacing, warm up and measure roughly one minute of a representative linked encounter plus a modest stress fixture at full visual quality, recording median/p95 frame time, stalls and the actual framebuffer. Review visible play against the 60 FPS target. Follow [performance comparisons](verification.md#performance-comparisons); five-second walking samples, software rendering and non-Windows results do not certify this target. Keep records outside Git and leave acceptance open if the host, hardware identity or required measurement is unavailable.

## Signed Mac packages for Steam

Steam's [macOS requirements](https://partner.steamgames.com/doc/store/application/platforms?l=english#apple-macos) require new Mac applications to be 64-bit and notarized. Our current Mac package targets Apple silicon only; signing does not add Intel support. Use `npm run desktop:dev` for everyday iteration and signed Game packages for release testing.

### One-time account setup

1. Install full Xcode and select its developer tools with `xcode-select` if necessary. Verify `xcrun --find notarytool` and `xcrun --find stapler`.
2. In Xcode Settings, open Accounts, select the developer team, then Manage Certificates. Create **Developer ID Application**, not Apple Development, Apple Distribution or Developer ID Installer. Creation requires the Account Holder. Apple's [certificate guide](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) describes the website/CSR alternative. Keep the private key in Keychain; a downloaded certificate alone cannot sign without its matching private key.
3. Run `security find-identity -v -p codesigning` and confirm a valid `Developer ID Application: NAME (TEAMID)` identity. Packaging discovers it automatically when exactly one is installed; `--identity` selects one explicitly if several are installed. Use its release team's ID for notarization; another Apple Development identity may belong to a different team.
4. At [Apple Account](https://account.apple.com/), create an app-specific password under Sign-In and Security. Run the following in your own Terminal, supplying your release team ID. Enter the developer account email and app-specific password at the interactive prompts. Do not put passwords, certificate exports or private keys in Git, chat or command arguments.

```sh
xcrun notarytool store-credentials lantern-knight-notary --team-id YOUR_TEAM_ID
```

The command validates credentials and stores them in Keychain. Use an app-specific password, not the normal account password. Apple's [notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) describes the process. For a future CI release job, provision a temporary signing keychain and notarization credentials through the CI secret store; ordinary CI packaging passes `--unsigned` and stays unsigned.

### Build and verify

From the intended checkout, the normal Mac release command handles signing, notarization, ticket stapling and validation:

```sh
npm run package -- --platform mac
npm run test:desktop -- game
```

`npm run package` on a Mac defaults to the same signed Game release. Packaging discovers the single valid Developer ID Application certificate/private key and uses the `lantern-knight-notary` Keychain profile. Missing or ambiguous identities and invalid credentials stop packaging before the build; it never silently falls back to an unsigned release. `--identity` and `--notary-profile` override these defaults. The existing `--signed` flag remains an explicit signed-mode assertion and rejects `--dev`, `--local`, `--unsigned` and Windows targets. Signing requires a macOS host.

Use `npm run package -- --unsigned` for a development Game package or CI verification without Apple credentials. The desktop CI workflow makes this choice explicitly. Developer packages (`--dev`) and local-asset prototypes (`--local`) remain unsigned by default. Browser builds and live desktop development do not package or notarize an app.

Signed release packaging consumes pinned assets. `--prebuilt` may select already verified desktop outputs. Signing uses hardened runtime, secure timestamps and the JIT entitlement needed by Electron. The top-level app and nested binaries also receive the library-validation and DYLD exceptions required by Steamworks and the overlay. These are hardened-runtime exceptions, not App Sandbox; Steam's documentation says not to enable App Sandbox.

Packaging verifies the Developer ID signature, creates a submission ZIP under ignored `release/`, uploads it to Apple and requires an **Accepted** response. It then staples and validates the ticket and runs Gatekeeper assessment. A failed stage fails the command; a package is not ready merely because signing succeeded. The command changes no asset pin and performs no Steam upload.

The deliverable is `release/mac-arm64/Lantern Knight.app`. The ZIP is the pre-stapling submission artifact; upload the validated `.app` to the Steam depot. Keep the bundle unchanged after signing. New executable builds require signing and notarization again. Test an actual Steam beta installation, launch, update and overlay on supported Macs before marking the Steamworks **App Bundles Are Notarized** checkbox. Direct executable desktop tests do not prove the Steam launch path or guarantee that macOS never shows a verification dialog.

### Apple rejection or timeout

Retrieve Apple's detailed log using the submission ID printed by packaging:

```sh
xcrun notarytool log SUBMISSION_ID --keychain-profile lantern-knight-notary
```

Apple may continue processing after the 30-minute wait expires. Before submitting again, inspect `notarytool history` or `notarytool info SUBMISSION_ID` with the same `--keychain-profile`. If that submission is Accepted and the bundle still matches it, run `xcrun stapler staple`, `xcrun stapler validate` and `spctl --assess --type execute --verbose=2` on the `.app`, followed by the desktop test. If rejected, fix the logged issue and rebuild. First-time developer submissions may require more time; do not disable Gatekeeper to make a release pass.
