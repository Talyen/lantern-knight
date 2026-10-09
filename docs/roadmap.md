# Roadmap

Author new prototype scenes and build a cohesive progression loop. [Game design](game-design.md) owns design intent; this page tracks capability, priorities and acceptance.

Implemented means reachable in source, in progress means unfinished, planned means agreed direction, and needs design means a decision or playtest is required. These statuses do not certify current checks, visual polish or release availability. Supplied hero animation artwork remains TEST material pending visible playtesting.

## Built

| Capability | Current limits and source |
| --- | --- |
| Independent area capabilities | Activation, clear-gated forward passage and retreat are protected by owned gameplay fixtures; Game currently starts empty. [Content](../src/content/game-content.ts), [area tests](../tests/unit/churchyard.test.ts). |
| Movement and combat | Keyboard movement, mouse aim, alternating sweep/lunge, dodge, health, hurt/death and encounter retry. Four-heading actions use supplied art and authored timing. [Simulation](../src/core/simulation.ts), [hero actions](../src/content/hero-actions.ts), [action tests](../tests/unit/hero-actions.test.ts). |
| Prototype lantern | Aimed cone, immediate damage, brief stagger and cooldown with directional cast art. Burn/DoT remains planned. [Simulation](../src/core/simulation.ts), [visual mappings](../src/content/visuals.ts). |
| Sessions and checkpoints | Encounter state survives revisits; manual and boundary saves use disposable prototype checkpoints with isolated player/developer profiles. [Application](../src/application.ts), [persistence](../src/core/persistence.ts), [system tests](../tests/unit/systems.test.ts). |
| Presentation and developer tools | Elevation/collision, painted geometry, occlusion/reveal, lighting, weather and visual preferences; Sandbox/labs, editor and the dedicated effects test scene in Sandbox. [Architecture](architecture.md), [developer tools](developer-tools.md), [visual tests](../tests/assets/visual-effects.test.ts). |
| Asset and desktop delivery | Pinned external packs, offline cache reuse, and macOS/Windows Game packaging; developer packages are optional. [Assets](assets.md), [delivery](release.md), [CI](../.github/workflows/ci.yml). |

## Now

| Work | Status | Remaining outcome |
| --- | --- | --- |
| Combat feel and aiming | In progress | Playtest commitment, buffering, dodge timing and movement/action facing. Resolve [dodge cancellation](game-design.md#combat-feel). |
| Damage types and lantern Burn | Needs design | Physical sword and Burn special are planned; resolve AoE/use limits, stagger, DoT timing and weaknesses under [damage](game-design.md#damage-types-and-burn) and [lantern design](game-design.md#lantern-ability). |
| Enemy actions and cues | Planned | Readable movement, attacks, hurt and death. Skeleton states currently use a resting clip in [visual mappings](../src/content/visuals.ts). |
| Combat feedback and audio | Planned | Coherent impacts, weaknesses, cast/Burn feedback, sound and music. Follow [action feedback](game-design.md#player-action-feedback) and [planned audio](architecture.md#planned-audio). |
| Onboarding and settings | Planned | Teach controls and refine the HUD, pause/checkpoint flow and visual settings. [Player UI](../src/game-ui.ts). |
| Area and presentation cohesion | In progress | Polish routes, collision, elevation, composition and combat visibility. [Content](../src/content/game-content.ts), [world art](../src/content/world-art.ts). |

Acceptance: a new player understands the controls, reads enemy actions, uses sword and lantern meaningfully, traverses both areas, retries after death and saves/resumes reliably. Confirm through visible playtesting and applicable automated checks. The opening does not need a chapter ending.

## Next

Design levels/stats, equipment/loot and permanent upgrades together, then implement a minimal reward-and-choice loop in existing content. Resolve attributes, slots, reward cadence and relationships before implementation. Persist progression and retain it on death while retrying the encounter. See [character progression](game-design.md#character-progression).

## Later

Extend the adventure and authored rewards, equipment, upgrades and encounters after combat polish and the first progression loop. Destinations, bosses and speculative systems remain uncommitted; see [world structure](game-design.md#world-structure).

## Open design decisions

Before implementation, resolve dodge cancellation, lantern shape/targeting/use limits/stagger, Burn duration/cadence/refresh/weakness values, and progression relationships in the linked design sections above. Keep decisions in [Game design](game-design.md), then update the corresponding work here.

## Presentation and delivery acceptance

| Work | Status | Acceptance |
| --- | --- | --- |
| Hero animation treatment | In progress | Inspect every clip/direction for mixed-registration transitions, bounded stabilization, weighted locomotion and rigid-sword protection. Large pose changes or uncertain equipment retain authored holds; further smoothing needs compatible art or stronger correspondence and preserves action consequences. |
| Hero attachments | Planned | Validate per-frame/direction attachments, registration, source density, hands, pose joins and gameplay readability. Immediate kit and production-method choices follow [presentation defaults](game-design.md#presentation-and-delivery-defaults). |
| Replacement combat effects | Planned | Integrate newer external sword/lantern art with explicit directional bindings, timing and attachments; retired placeholder arcs/flare are not final effects. |
| Windows acceptance | Needs design | Name reference CPU/GPU/display and validate packaged 1440p/60 FPS. macOS and software smoke do not certify target performance. |
| Performance and lifetime | Planned | Warm up, measure roughly one minute in a seeded representative encounter and a modest stress fixture; record median/p95/stalls, environment, buffer size and scale. Account separately for downloads, decoded CPU data, GPU textures/mips, render targets and temporary allocations; verify settled growth across repeated room changes. Follow [performance comparisons](verification.md#performance-comparisons). |

Update existing items as work advances; move completed capabilities into Built. Promote local work after integration and relevant validation, reporting evidence separately from status. Keep dates, historical reports and generated output out of this page. [Task coordination](task-coordination.md#handoff-and-commits) owns integration; [Verification](verification.md) owns checks.
