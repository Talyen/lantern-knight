# Lantern Knight — Roadmap

Build a deliberate, responsive sword-and-lantern adventure in small, connected, hand-authored areas. The immediate goal is to polish Graveyard Approach and Ruined Chapel; these are the beginning of a continuing game, not a chapter requiring an ending. Character progression follows as a cohesive system of levels/stats, equipment/loot and permanent upgrades.

## Status and evidence

- **Implemented**: reachable capability exists in source; this does not certify polish or release availability.
- **In progress**: partial implementation or local integration still needs completion and validation.
- **Planned**: agreed direction with implementation ahead.
- **Needs design**: an explicit decision or playtest is required before implementation.

The baseline includes the current hero-action integration; supplied animation artwork remains TEST material pending visible playtesting. Source and existing test links provide inspection evidence, not a claim that tests currently pass. Current build, visible gameplay and hosted CI verification must be recorded separately when performed.

## Built — existing capabilities

| Feature | Status | Current capability and limits | Source |
| --- | --- | --- | --- |
| Connected opening areas | Implemented | Graveyard Approach has one skeleton and Ruined Chapel has two; quiet approach, encounter activation, clear-gated forward passage and retreat are authored. | [World](../src/content/world.ts), [area tests](../tests/churchyard.test.ts) |
| Core movement and combat | Implemented | Keyboard movement, mouse aiming, sword damage, dodge, health, hurt/death and current-encounter retry exist. Alternating sweep/lunge actions are integrated; combat polish is tracked under Now. | [Simulation](../src/core/simulation.ts), [input](../src/core/input.ts), [session](../src/core/session.ts) |
| Prototype lantern ability | Implemented | A mouse-aimed cone deals immediate damage and brief stagger on a cooldown. An ability-state animation hookup exists; the four-direction cast is integrated with supplied TEST artwork. This prototype is not the planned Burn special. | [Simulation](../src/core/simulation.ts), [visual mappings](../src/content/visuals.ts) |
| Sessions and checkpoints | Implemented | Encounter state survives revisits; manual saves and boundary autosaves share a protected checkpoint. Load/New Game authorization and player/developer profile isolation protect existing data. | [Application](../src/application.ts), [persistence](../src/core/persistence.ts), [system tests](../tests/systems.test.ts) |
| Painted environment presentation | Implemented | Authored elevation/collision, painted geometry, occlusion/reveal, lighting, weather and persistent visual preferences exist. Rendering capability does not establish final visual quality. | [Foundation](foundation.md), [lighting](lighting-lab.md), [visual tests](../tests/visual-effects.test.ts) |
| Developer tools | Implemented | Sandbox, animation/calibration/lighting labs and an independent Effects Playground support inspection and comparison. Player builds exclude developer screens. | [Sandbox](../src/sandbox-ui.ts), [Effects Playground](effects-playground.md) |
| Desktop delivery and verification | Implemented | Game/Dev build and packaging paths target macOS and Windows, with automated checks and desktop smoke journeys. This records infrastructure, not a current release or green CI claim. | [Commands](../package.json), [CI](../.github/workflows/ci.yml) |
| Prepared asset delivery | Implemented | External source ownership, pinned prepared packs, offline reuse and a bounded external cache separate art authoring from ordinary development. | [Assets](assets.md), [pack tests](../tests/asset-packs.test.ts) |
| Directional hero actions | Implemented | Four-heading sweep/lunge alternation, dodge, lantern cast, hurt and death are integrated with authored timing and native registration. Automated local checks cover action timing and rendering; supplied TEST art still needs visible playtesting and polish. | [Hero actions](../src/content/hero-actions.ts), [action tests](../tests/hero-actions.test.ts) |

## Now — polish the two existing areas

| Feature | Status | Intended outcome or remaining work | Source |
| --- | --- | --- | --- |
| Combat feel and aiming | In progress | Tune commitment, buffering, dodge timing and readability through playtesting. Local code currently waits for a complete attack before dodging; cancellation policy still needs a design decision. | [Simulation](../src/core/simulation.ts), [design intent](game-design.md#combat-feel) |
| Damage types and weaknesses | Planned | Sword attacks deal Physical damage; the lantern deals Burn damage. Enemy weaknesses modify both initial Burn damage and Burn DoT ticks. | [Damage design](game-design.md#damage-types-and-burn) |
| Lantern Burn special | Needs design | Replace the prototype behavior with an AoE special dealing immediate Burn damage and one refreshing Burn DoT. Resolve shape, targeting, timing, use limits and stagger before implementation. | [Lantern design](game-design.md#lantern-ability) |
| Enemy actions and attack cues | Planned | Give enemy movement, attacks, hurt and death readable animation and cues. Skeleton visuals currently map all states to a resting clip. | [Visual mappings](../src/content/visuals.ts) |
| Combat feedback | Planned | Make sword impacts, damage, enemy weaknesses, lantern application and ongoing Burn readable and coherent with the artwork. | [Design intent](game-design.md) |
| Audio | Planned | Add sound and music supporting actions, combat feedback and the atmosphere of both areas. | [Polish priorities](game-design.md#prototype-priorities) |
| Onboarding and settings usability | Planned | Help a new player understand movement, aiming, sword, dodge and lantern; refine the existing HUD, pause/checkpoint flow and visual settings. | [Current player UI](../src/game-ui.ts) |
| Area and presentation cohesion | In progress | Polish routes, collision, elevation, environment composition and combat visibility across the existing areas. | [World](../src/content/world.ts), [lighting](lighting-lab.md) |

**Polish acceptance:** a new player can understand the controls, read enemy actions, use sword and lantern meaningfully, traverse both areas, retry after death and save/resume reliably. Confirm this with visible playtesting as well as applicable automated checks; a chapter ending is not required.

## Next — cohesive character progression

| Feature | Status | Intended outcome or remaining work | Source |
| --- | --- | --- | --- |
| Integrated progression design | Needs design | Define levels/stats, equipment/loot and permanent upgrades together. Favor authored rewards and deliberate build choices; resolve how rewards feed each layer before implementation. | [Progression intent](game-design.md#character-progression) |
| First progression loop | Planned | Implement a minimal connected reward-and-choice loop in existing content, with player-facing information and persistent progression. | [Progression intent](game-design.md#character-progression) |
| Progression and death | Planned | Retain earned progression on death while retrying the encounter. Extend checkpoint persistence to the new progression state. | [Progression intent](game-design.md#character-progression), [current sessions](../src/core/session.ts) |

## Later — extend the foundation

| Feature | Status | Intended outcome or remaining work | Source |
| --- | --- | --- | --- |
| Adventure expansion | Planned | Continue beyond the existing areas after combat polish and the first progression loop are established. Choose destinations and encounters during later design. | [World intent](game-design.md#world-structure) |
| Progression content expansion | Planned | Expand authored rewards, equipment, upgrades and encounters to support the established progression loop. | [Progression intent](game-design.md#character-progression) |

Specific bosses, destinations and additional speculative systems are not commitments in this roadmap.

## Open design decisions

| Decision | Required outcome | Before |
| --- | --- | --- |
| Lantern AoE and use limits | Choose shape, range, targeting, cooldown/resource policy and whether stagger remains. The current aimed cone/cooldown is a prototype, not the final specification. | Burn special implementation |
| Burn and weaknesses | Choose duration, tick cadence, refresh timing and weakness values. Keep one refreshing DoT; weaknesses affect initial damage and ticks. | Damage/status implementation |
| Dodge cancellation | Confirm complete-attack commitment or define an allowed cancellation window through playtesting. | Combat-feel sign-off |
| Progression relationships | Choose attributes, equipment slots, reward cadence and how levels, loot and permanent upgrades interact. | First progression loop |

## Maintaining this roadmap

Update existing rows as features advance; move completed work into Built rather than appending historical reports. Keep items at feature level and link detailed contracts or focused tests instead of copying them here. Resolve design decisions in [design intent](game-design.md) and update the corresponding roadmap rows together.

Promote local work only after integration and relevant validation. Record verification scope accurately and separately from feature status. Keep architecture in [foundation](foundation.md) and delivery verification expectations in [handoff](handoff.md). Avoid speculative dates, generated artifacts and historical output in this document.

## Delivery and animation acceptance

| Work | Status | Acceptance |
| --- | --- | --- |
| Current hero animation treatment | In progress | The current-kit implementation supplies mixed-registration transitions, bounded stabilization, weighted locomotion and rigid-sword protection. Finish visual acceptance per clip/direction; large action-pose changes or uncertain equipment retain authored holds. Further smoothing requires compatible supplied art or stronger correspondence, without changing action consequences. |
| Hero attachments and production validation | Planned | Validate per-frame/direction effect attachments, registration, source density, hands, pose joins and gameplay readability. Eight-direction running and four-direction idle/action artwork are the immediate route; additional action directions and future production methods remain open. |
| Replacement combat effects | Planned | Integrate the newer external sword/lantern artwork with explicit directional bindings, timing and attachment metadata. Retired placeholder arcs/flare are not final effects. |
| Windows delivery acceptance | Needs design | Select reference CPU/GPU and display; validate packaged Windows at 1440p/60 FPS. macOS and software-renderer smoke results do not certify target performance. |
| Bounded performance and lifetime pass | Planned | Warm up, measure roughly one minute in a seeded representative encounter and a separate modest stress fixture; record median/p95/stalls, environment, buffer size and scale. Account separately for download, decoded CPU, GPU textures/mips, render targets and temporary allocations; verify growth settles across repeated room changes. |
