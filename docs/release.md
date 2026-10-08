# Public release runbook

Use this workflow when a public game release is requested. [Contributing](../CONTRIBUTING.md#verification) owns verification; [assets](assets.md) owns pack publication and retention. Publishing a prepared asset pack is distinct from shipping a game. Implementation work alone does not request a commit, tag, upload or promotion.

## Distribution prerequisites

Current packaging produces unpacked macOS arm64 and Windows x64 Game/Dev applications. The macOS configuration explicitly has no signing identity; installers, notarization, production signing credentials and a player distribution/promotion channel are not configured. Choose and implement those requirements for the intended channel before describing a candidate as publicly ready. Existing unsigned CI packages establish automated behavior only. Review asset provenance, licenses and required player notices for the included material; current hero TEST artwork still needs the visible polish acceptance recorded in [roadmap](roadmap.md).

## Prepare a candidate

1. Review the complete changed-file inventory and task-owned patches through the [review workflow](../CONTRIBUTING.md#review-and-investigation). Preserve unrelated work. A supported release needs a clean, reviewed commit; do not clean the checkout destructively to obtain it.
2. Choose the intended version in `package.json` and identify the exact commit and pinned `assets/lock.json` revision. Ordinary builds consume that pin. Changed art recipes require the explicit art-authoring workflow, not regeneration in CI.
3. Run the regular gates and both Game/Dev builds. Verify both identities, then package the prebuilt outputs on the applicable hosts using the commands below. The [CI workflow](../.github/workflows/ci.yml) reuses checked build artifacts; [Contributing](../CONTRIBUTING.md#e2e-coverage-and-execution-budgets) owns platform coverage and execution budgets. Avoid rebuilding a different candidate between identity verification and packaging.
4. Follow the hosted run for that exact commit to final job conclusions. A missing run, failed job or policy-skipped desktop job leaves that evidence incomplete. PR checks alone do not include desktop packaging/smoke.

### Build and package pinned outputs

After regular gates pass, build and verify both applications:

```sh
npm run build
npm run build:dev
npm run build:verify
npm run build:dev:verify
```

Package those outputs on the matching host:

| Host | Game | Dev |
| --- | --- | --- |
| macOS | `npm run package:mac:prebuilt` | `npm run package:dev:mac:prebuilt` |
| Windows | `npm run package:win:prebuilt` | `npm run package:dev:win:prebuilt` |

Run `npm run test:e2e` afterward. `npm run verify:full` combines regular gates, builds, host packaging and E2E when separate candidate stages are unnecessary.

## Verify the delivered application

Identity includes file checksums, source commit/dirty status, the prepared asset pin, and the guarded dependency-bundle marker. Vite/esbuild bundle runtime dependencies; the Electron build rejects external imports except Electron and Node built-ins. Packaging verifies the identity before the shared `beforeBuild` hook marks dependency handling as external, avoiding a redundant package-manager traversal. E2E additionally checks that the actual packages match the verified build outputs.

`LANTERN_EXECUTABLE` overrides every smoke launch with one executable. Use it for a single-target check, such as `npm run smoke:game -- --visible` against a delivered Game executable. Leave it unset for `test:e2e` and `verify:full`, which need distinct Game/Dev packages at their expected locations. Each smoke owns an isolated temporary profile; do not use existing player data.

Visibly playtest the actual player candidate: startup, controls and aiming, both opening areas, enemy cues, death/retry, pause, New Game authorization, save/load and exit/restart. Confirm player builds exclude developer tools. Validate the chosen platform's signed/installed artifact after signing or repackaging, including startup and save behavior; the unsigned prebuilt application does not substitute for that final check. Signing and notarization need their platform/channel verification once configured.

## Notes and promotion

Prepare concise player notes from the reviewed commits: resulting behavior, material known issues and supported platforms. Future commits should use Conventional Commit types and `User-Facing: yes` or `User-Facing: no` trailers when player relevance is ambiguous. Infrastructure-only changes need no player note. Keep generated notes and distributed binaries in the chosen external release channel, not as historical checkout reports.

Before requested promotion, bind the game version/tag to the exact verified commit, application checksums, asset pin and completed CI evidence. Update `assets/supported.json` with the supported game tag so pack retention protects it. Retain the previous supported application's artifacts and pin. Only publish/promote through the selected channel after its distribution prerequisites and final-artifact checks pass. There is currently no automatic game promotion command.

## Failure and rollback

If build or verification fails, stop promotion, repair the cause and validate a new candidate. If upload outcome is unknown, inspect the existing release before retrying; do not create a second version merely to resume monitoring. A failed hosted run is not a successful release even when local checks passed.

For a published regression, withdraw promotion or restore the previous verified application through the selected channel. Preserve player saves before any recovery action. A prior executable may reject newer save data; never downgrade, reset or overwrite those bytes to force startup. Reproduce against isolated copies and the recorded asset pin, then deliver a compatible fix. Keep previous supported tags until the support policy explicitly retires them; use the existing asset cleanup workflow only afterward. Record final release/rollback evidence in the handoff, not this runbook.
