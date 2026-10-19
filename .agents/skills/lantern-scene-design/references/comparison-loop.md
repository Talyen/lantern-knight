# Screenshot preference loop

The agent conducts a bounded session; the human only chooses A or B. Do not ask why, request ratings or ask the human to operate tools. If both images have visible technical defects, repair them before presentation. No human choice means pending, never implicit acceptance. Screenshot preference cannot certify combat or traversal.

## Set up an experiment

Use an isolated task checkout. Keep sessions under an external durable directory such as `~/.codex/scene-placement/`. Read [the command guide](../../../../docs/scene-placement-learning.md) for the executable format.

Freeze a scene snapshot, a brief with required gameplay functions, available assets, the current skill and a fixed camera. Preserve the source painting, floor dimensions, lighting, hero pose, encounter roster, rewards and exits. The command permits object changes and relocation of existing enemies; this isolates placement from art generation and difficulty changes. Coordinate changes can still affect difficulty, so playtest them.

Declare practice and holdout scenes before tuning. Start with Abandoned Orchard and Forest Gathering Clearing for practice; reserve Ruined Forge and Desecrated Chapel for transfer checks. Freeze each scene's starting snapshot for the session. Do not repeatedly tune against a holdout and continue calling it unseen. After inspecting a holdout result, use a fresh task or scene for subsequent independent evaluation.

Compare the current best layout with one challenger. Before generating the challenger, write one testable hypothesis, such as moving a scattered supply group to a painted work landmark. Use a comparable effort budget for alternatives. A trial that changes several unrelated things cannot identify which caused the preference.

For skill comparisons, freeze baseline and candidate instruction files, start fresh attempts from the same scene and brief, and keep the same assets and iteration budget. Do not give either attempt the expected winner or prior reviewer conclusions. Use independent agents for these transfer attempts when delegation is available and authorized, with only the assigned instructions, brief and raw scene/assets; generating both after reading the proposed lesson is not an independent comparison. A local layout win alone does not prove that a skill revision improved agent performance. If independent attempts are unavailable, record the comparison as a placement diagnostic and defer the skill-performance claim.

## Capture and ask

Prepare the comparison, then run its capture command. It imports both snapshots without saving them, resolves artwork and placement constraints, fixes viewport/framing, freezes prop animation and random seed, checks matching framing, and produces randomly assigned `A.png` and `B.png`. The receipt records the actual asset identity and renderer. Hardware is the default; disclose software fallback. These are still editor composition captures, not gameplay acceptance.

Inspect both images yourself. Check that they show the actual placement difference, both satisfy the brief, and no selection outlines or startup errors obscure them. An unchanged-looking view is not useful feedback even if PNG hashes differ. Capture additional matching views for your own checks when needed. The human sees exactly two unannotated screenshots of the same view, labeled A and B. No hypothesis, proposed winner or evaluative captions.

Ask only: **Which do you prefer, A or B?** Stop at this natural feedback boundary. On reply, record that choice against this exact round before changing anything. Never manufacture a human preference from an agent critique. Keep evidence outside disposable worktrees so a later chat can resume a pending round.

## Revise and transfer

Use the winner as the next local incumbent, preserving all previous alternatives and choices. Keep raw votes, candidate mappings and hashes. A close pair may need a second comparison with swapped labels in a new round; do not ask the human for certainty. Stop generating pairs when the user stops or when repeated comparisons cease to identify a useful improvement; leave the result pending without inventing a verdict.

Explain the result privately in an external session note as an agent hypothesis. Test that explanation through another targeted placement change. Update [placement lessons](placement-lessons.md) with compact evidence, including contradictory votes. Revise the skill narrowly when the lesson transfers to a different scene. Report win/loss counts with the tested scenes and budget; do not claim statistical confidence from a handful of preferences.

Before accepting a skill revision, compare fresh baseline/candidate attempts on a reserved scene at matching effort, show another A/B pair, and record the human choice. Keep a losing instruction out of the accepted skill. Review traversal, interaction states, occlusion and combat independently; a screenshot winner remains a visual preference.

Commit reviewed skill/process changes and integrate under the normal repository lock and verification rules. Learning artifacts survive worktree cleanup. Do not register candidate scenes in Game or replace production layouts merely because one screenshot won; scene implementation remains scoped to the user's requested scene work.
