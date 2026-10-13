# Recorded session replay

The Node harness drives the shipping `GameSession.step`, transition, reset and capture/restore methods plus `Persistence` and `parseGame`. It adds no game rules and never mutates simulation actors to manufacture a result. It does not load artwork or render the game, and is excluded from runtime entry points.

```sh
npm run benchmark -- record authoring/session-opening.json
npm run benchmark -- replay /external/session.json
```

Use the `session.json` path printed by recording in the replay command; `/external/session.json` is a placeholder. The [opening recipe](../authoring/session-opening.json) provides a runnable example.

Recording writes a bounded external-cache bundle containing the recipe, source/content hash, commit/dirty attribution, pinned asset hash, Node version, action hashes, reached areas/events and final checkpoint. It writes the input and each attempted/completed action before continuing; a failed recording retains that journal and bounded diagnostics, and never retries a committed action. Replay runs those actions again in a fresh CLI process and requires exact recorded results. Copy needed evidence to another external workspace before cache eviction; no bundles or journals belong in Git. `--experiment` explicitly labels replay under changed source/assets/Node as a regression experiment; it still fails if results diverge.

Replay and benchmark identity follows the runtime/build input scope in [source identity](../tools/source-identity.ts), including authored content and the asset pin; Node version is recorded separately. Root documentation, `docs/` guides and tests are outside that hash scope; README files under `authoring/` are included. Commit and dirty attribution describe the whole checkout. Old evidence can be read as an explicit regression experiment; it does not become a current passing check.

Recipes are small authored JSON inputs: optional integer `seed` (default 142), optional `initialSave`, and `actions`. A step supplies `ticks` and a simulation command with `move`/`aim` x/z points plus optional attack, ability, dodge and generation fields. The same command is applied on every tick in a step group. Use a separate one-tick step for a single attack, ability or dodge input, followed by a step with that flag omitted. Save, load and reset actions use only their `kind`. Each step group has 1–3600 ticks; a recipe permits at most 1000 actions and 36000 total fixed steps. Files larger than 16 MiB are rejected. A Load requires an earlier acknowledged Save. Transitions reported by stepping are prepared and committed through the session owner.

The opening example exercises movement, action inputs, saving, manual reset and loading in the selected Game content. It does not establish encounter or area-transition coverage. Report reached areas and events: an unreached transition, death retry or progression mechanic is missing coverage. An `initialSave` recipe is labeled targeted evidence, never proof that a fresh player earned that state. Extend these recipes as the progression loop gains replay commands.

Action hashes include transient simulation state and RNG, an ordered digest of every emitted event within step groups, persisted checkpoint state and acknowledged save bytes. Save/load separately asserts round-trip parity for supported checkpoint fields. Checkpoints preserve the next sweep/lunge choice but omit the current action phase and other transient state; loading is not claimed to continue an uninterrupted frame-exact fight. Older prototype checkpoints without the next-attack field restart alternation with sweep. Repeating the same recorded save/load sequence is deterministic. Existing renderer-cadence tests retain their separate role.

Headless evidence does not establish input/UI wiring, animation, audio, visible pacing or physical storage durability. The harness uses an ephemeral byte transport; [browser/desktop tests](verification.md#test-selection) and storage tests retain current integration coverage. [Verification](verification.md) owns gates.
