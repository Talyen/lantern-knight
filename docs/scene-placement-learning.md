# Scene placement learning

Use [the scene-design skill](../.agents/skills/lantern-scene-design/SKILL.md) to place props/enemies and improve guidance through human screenshot preferences. [The loop](../.agents/skills/lantern-scene-design/references/comparison-loop.md) owns experiment selection, interpretation and transfer. The human only chooses between two screenshots. Agents handle all setup, checks and writing.

## Prepare a pair

Create an external session directory under `~/.codex/scene-placement/`. Save baseline and candidate scene JSON snapshots, plus the exact instruction text used for each attempt. Include any placement references the attempt read in that instruction snapshot; copying only a routing paragraph does not freeze its guidance. Generated images, snapshots, receipts and votes remain outside Git. The repository retains the skill, command, capture scenario and compact [lessons](../.agents/skills/lantern-scene-design/references/placement-lessons.md).

Write `spec.json` beside those snapshots. Paths resolve relative to that file. The camera and requirements are chosen by the agent before comparing, not requested from the human. For example:

```json
{
  "baseline": "baseline.json",
  "candidate": "candidate.json",
  "baselineSkill": "baseline-skill.md",
  "candidateSkill": "candidate-skill.md",
  "phase": "practice",
  "brief": "Keep the supplies beside the work area, preserve the route and both encounter guards.",
  "hypothesis": "Grouping supplies around a painted landmark improves coherence.",
  "requirements": {
    "objects": ["clearing-chest", "camp-hamper"],
    "enemies": ["clearing-a", "clearing-b"],
    "minProps": 2,
    "minEnemies": 2
  },
  "view": {
    "center": { "x": 5, "z": -1 },
    "hero": { "x": 6.7, "z": 5.5 },
    "verticalSpan": 12
  }
}
```

Use meaningful requirements from the brief, not a universal object quota. The command rejects unchanged pairs, missing required objects/enemies, changes outside independent objects and spawn positions, and enemy roster/combat-rule changes. The editor resolves actual assets and placement clearance during capture. It cannot establish that a painted path is visually open or a fight is well designed; inspect and playtest those separately.

From the task checkout, with an unused preview port:

```sh
npm run scene:compare -- prepare --spec /external/session/spec.json --round /external/session/round-01
LANTERN_PREVIEW_PORT=5176 npm run scene:compare -- capture --round /external/session/round-01
```

The parent directory can exist; the round directory must be new. `round.json` records the brief, hypothesis, phase, camera, checkout commit, asset pin, scene/instruction hashes and randomly assigned A/B mapping. Capture uses the managed browser runner and its shared GPU lane. It never saves either imported scene. `capture.json` records matching actual framing, actual prepared asset identity, renderer and image hashes. Pinned or local development artwork follows the current preview selection; both alternatives use the same preview session. A changed pin requires a new round. `--software` is an explicit fallback and must be reported.

Capture holds a per-round directory lock and rejects completed rounds. The browser writes `capture-pending.json`; only a successful runner exit, including fixture teardown, publishes `capture.json`. Failed attempts may be retried after the owned process closes; no completed receipt means the pair is incomplete. If a process was killed before releasing `capture-lock`, establish that its capture process ended before removing that empty directory. Do not interrupt another occupied GPU lane. Preserve failed evidence when useful, and prepare a new round if any input changes. These diagnostics stay outside routine CI.

## Record a preference

Inspect the resulting `A.png` and `B.png`, then show them inline with only A/B labels. Ask: **Which do you prefer, A or B?** No explanation, ratings or other feedback is requested. Wait for the actual answer. Record it with:

```sh
npm run scene:compare -- vote --round /external/session/round-01 --choice A
```

`preference.json` binds the human choice and winning variant to the round and capture hashes. Voting rejects incomplete capture, changed snapshots/images and an existing decision. Never run `vote` based on an agent's preference. The files are local experiment records, not tamper-proof attestations. Keep the external session path with any compact lesson so subsequent chats can find the evidence.

Keep the human question limited to A/B. If they voluntarily reject both, record `--choice neither`; it writes a null winner. Optional `--feedback` preserves their volunteered wording without asking for an explanation. Neither layout becomes an accepted incumbent. Return to distinct overall compositions before testing small refinements. A rejection alone does not identify the aesthetic defect.

For another camera, a new challenger or another judgment, prepare a new round. Do not overwrite the screenshot associated with an existing vote. Resume pending feedback from its two preserved images; record the answer before continuing.

## Learn and verify

Separate a preferred layout from a proven explanation. Record agent explanations as hypotheses, test controlled changes and retain contrary results. Validate transfer on another scene before adding a general instruction. Compare fresh baseline/candidate attempts at equal effort on a predeclared holdout to evaluate a skill revision. Repeatedly tuning to one scene only measures local improvement.

Run `npm run check` and `npm run docs:check` for repository changes. The focused preference-record tests run with `npm test -- tests/unit/scene-placement.test.ts`. A real capture validates the capture path; it does not certify aesthetics, combat, native rendering or human acceptance. [Verification](verification.md) owns additional scene and gameplay checks.
