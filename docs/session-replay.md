# Recorded session replay

The Node harness drives the shipping `GameSession.step`, transition, reset and capture/restore methods plus `Persistence` and `parseGame`. It adds no game rules and never mutates simulation actors to manufacture a result. It does not load artwork or render the game, and is excluded from runtime entry points.

```sh
npm run session:record -- authoring/session-opening.json
npm run session:replay -- /external/printed-session.json
```

Recording prints a bounded external-cache bundle containing the recipe, source/content hash, commit/dirty attribution, pinned asset hash, Node version, action hashes, reached areas/events and final checkpoint. It writes the input and each attempted/completed action before continuing; a failed recording retains that journal and bounded diagnostics, and never retries a committed action. Replay runs those actions again in a fresh CLI process and requires exact recorded results. Copy needed evidence to another external workspace before cache eviction; no bundles or journals belong in Git. `--experiment` explicitly labels replay under changed source/assets/Node as a regression experiment; it still fails if results diverge.

Replay and benchmark identity share the regular verification file-discovery and hashing owner, using an explicit runtime scope. It includes runtime source, imported authored JSON such as live scene documents, runtime configuration and replay/identity code; documentation and unrelated recipes/tests remain outside that scope. The pack hash and Node version are recorded separately. New bundles use schema version 2 and identity version 2. Existing version-1 bundles remain readable only as `--experiment` evidence because their old digest omits live scene inputs. Matching identity establishes only this simulation scope.

Recipes are small authored JSON inputs: optional integer `seed` (default 142), optional `initialSave`, and `actions`. A step supplies `ticks` and a simulation command with `move`/`aim` x/z points plus optional attack, ability, dodge and generation fields. Save, load and reset actions use only their `kind`. Each step group has 1–3600 ticks; a recipe permits at most 1000 actions and 36000 total fixed steps. Files larger than 16 MiB are rejected. A Load requires an earlier acknowledged Save. Transitions reported by stepping are prepared and committed through the session owner.

The opening example exercises movement, action inputs, saving, manual reset and loading. Report reached areas and events: an unreached transition, death retry or progression mechanic is missing coverage. An `initialSave` recipe is labeled targeted evidence, never proof that a fresh player earned that state. Extend these recipes with the progression loop when its production commands exist.

Action hashes include transient simulation state and RNG, an ordered digest of every emitted event within step groups, persisted checkpoint state and acknowledged save bytes. Save/load separately asserts round-trip parity for supported checkpoint fields. Checkpoints intentionally omit action phase, sword alternation and other transient state; loading is not claimed to continue an uninterrupted frame-exact fight. Repeating the same recorded save/load sequence is deterministic. Existing renderer-cadence tests retain their separate role.

Headless evidence does not establish input/UI wiring, animation, audio, visible pacing or physical storage durability. The harness uses an ephemeral byte transport; [player smoke](../README.md#develop-and-verify) and storage tests retain shipping integration coverage. [Contributing](../CONTRIBUTING.md#verification) owns gates.
