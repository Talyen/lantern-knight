# Lantern Knight — Design Intent

This document records the intended direction for the prototype and first playable. It describes design targets, not a claim that these features are already implemented. The [roadmap](roadmap.md) tracks existing capabilities and upcoming work. Exact timings, ranges and balance values remain open for playtesting.

## Combat feel

Combat should feel deliberate but responsive. Basic sword attacks alternate between sweep and lunge, with readable commitment and clear opportunities to react between actions.

The current implementation completes an attack before allowing a dodge. Confirm that policy through playtesting, or define an allowed cancellation window before changing it. Recovery cancellation is not yet an agreed requirement.

Start without a stamina system. Tune attack timing, input buffering, dodge timing and aiming together with the action animations.

## Player action feedback

Every supported player action should receive timely, perceivable acknowledgment and communicate its outcome visually. Essential meaning must remain understandable with sound muted; audio can reinforce it. Apply this principle to gameplay and UI design, implementation and review.

Reuse existing movement, action animation, focus/selection, cooldown indicators and status messages before adding effects. Make accepted, buffered and unavailable actions distinguishable where that affects the player's next decision; a queued attack must not look like an immediate hit or a rejected input like a successful cast. Unbound keys and noninteractive scenery require no response.

For delayed operations such as save/load, acknowledge pending work promptly, then communicate completion or failure without a success cue on failure. Pointer and keyboard interaction should communicate equivalent outcomes. Review combat polish and checkpoint flows against these expectations; this principle does not claim that every planned cue is already implemented or alter simulation timing.

## Damage types and Burn

Basic sword attacks deal Physical damage. The lantern special deals Burn damage immediately and applies Burn damage over time as a status effect. Some enemies can be weak to particular damage types.

Repeated Burn applications refresh one DoT rather than adding stacks. Enemy weakness modifies both the initial Burn hit and subsequent DoT ticks. Duration, tick cadence, refresh timing and weakness values require design and playtesting.

## Lantern ability

Develop the lantern as an AoE special attack that complements the basic sword attacks through immediate Burn damage and a refreshing Burn DoT.

The existing prototype is a mouse-aimed cone that deals immediate damage and brief stagger on a cooldown. Its animation hookup and current directional cast integration support development; they do not establish the final ability design.

Choose the AoE shape, range, targeting, cooldown/resource policy and whether stagger remains before implementing the Burn special. The prototype cone and cooldown are not final commitments.

## Movement and facing

Face the direction of travel while moving. Face the mouse aim direction for sword attacks and lantern casting.

Defer full aim-facing strafing initially: it requires additional animation work. The first playable should make the transition between movement-facing and action-facing clear and natural.

## Equipment

Use one fixed sword-and-lantern loadout while polishing the existing two areas. Build attachment hooks to support later equipment development.

Equipment and loot will form part of the cohesive progression system. Slots, item effects and their relationships to stats and permanent upgrades need design before implementation. Visible armor swapping and additional weapon animation sets are not current roadmap commitments.

## Character progression

Design levels/stats, equipment/loot and permanent upgrades as one cohesive system. Favor authored rewards and deliberate build choices. Define attributes, equipment slots, reward cadence and how rewards feed each progression layer before implementation.

Begin with a minimal integrated progression loop in existing content, including player-facing choices and persistent state. Retain earned progression on death and retry the encounter.

## World structure

Begin with small, connected, hand-authored areas and simple elevation. Polish Graveyard Approach and Ruined Chapel before expanding the adventure beyond them.

Graveyard Approach follows the Last Tended Light composition: a small broken gateway opens onto a worn processional path, an ancient oak shelters one low family terrace, and ground-level older burials merge into blue-green woodland. Eight burials include one visibly tended grave and one disturbed burial. A quiet central clearing supports the full dodge and the existing one-skeleton encounter. The chapel threshold is the strongest environmental light; interrupted paving, grouped roots and shelter-bound leaf/moss detail lead toward it. Retaining geometry and collision share the authored layout. A broken rear roof and belfry crown establish the exterior's age while keeping the entrance intact.

These areas are the beginning of a continuing game, not a chapter requiring a clear ending. Use them to establish traversal, combat, art and occlusion, then extend the world after combat polish and the first progression loop are established. Later destinations and encounters remain to be designed.

## Lighting

Use painted environmental lighting, simple contact shadows and selective glow from the lantern and spells.

Keep full dynamic relighting optional. The initial visual direction should work with the painted lighting approach, with selective glow supporting readability and atmosphere.

## Prototype priorities

Polish alternating sweep/lunge attacks, dodge, the Burn lantern special and movement/action facing transitions together across the existing two areas. Complete enemy action animation and attack cues, coherent hit/Burn feedback, sound and music, basic onboarding and settings usability.

Art validation should establish that elevation, occlusion, contact shadows and selective glow work coherently. Visible playtesting should confirm that a new player understands the controls, reads enemy actions, uses both attacks meaningfully, traverses both areas, retries after death and saves/resumes reliably.

Follow this with a cohesive progression loop before expanding the adventure. Resolve the open decisions in the [roadmap](roadmap.md#open-design-decisions) rather than treating prototype behavior as final design.

## Presentation and delivery defaults

Golden hour / HD-2D Diorama at 150% light response is the default in every Game area, Dev Preview and authoring scene. Both light rigs and all three looks remain available for authoring. Depth of field and saved visual preferences keep their existing behavior. The camera retains 45 degree azimuth, full-precision 35.264389682754654 degree elevation and 9 m initial vertical span.

Use supplied eight-direction running and four-direction idle/action artwork for the immediate hero kit. Further action direction coverage and a future controlled 3D or 2D production route remain open; the original briefs do not impose an eight-direction or rig requirement. Stabilization, guarded motion warp, rigid-sword protection and weighted walk rhythm and directed action holds are the selected animation treatment. Action lengths and gameplay windows are shared across headings; preserve deliberate loading and impact holds. Artwork registration changes only presentation; simulation remains authoritative for actions, damage and movement.

Windows is the primary delivery target, with macOS development support. Establish packaged 2560 x 1440 at 60 FPS on named reference hardware before making performance claims. 120 FPS remains a stretch goal.
