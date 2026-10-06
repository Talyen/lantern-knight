# Lantern Knight — Design Intent

This document records the intended direction for the prototype and first playable. It describes design targets, not a claim that these features are already implemented. Exact timings, ranges, and cooldowns remain open for playtesting.

## Combat feel

Combat should feel deliberate but responsive. Attacks carry commitment, while recovery gives the player a clear opportunity to react.

- Use a short, three-hit sword combo.
- Allow dodging to cancel attack recovery, rather than allowing cancellation during every attack phase.
- Start without a stamina system.

Playtesting should establish a satisfying rhythm between attacking and dodging, with readable commitment and responsive recovery cancellation.

## Lantern ability

The lantern produces a short, cone-shaped flare aimed at the mouse. Enemies caught in the flare are briefly staggered.

For the prototype, the flare uses a cooldown. This lets us test aiming, reach, stagger duration, and combat feel without first building a resource economy. Tune those values through playtesting before deciding whether a resource system would improve the game.

## Movement and facing

Face the direction of travel while moving. Face the mouse aim direction for sword attacks and lantern casting.

Defer full aim-facing strafing initially: it requires additional animation work. The first playable should make the transition between movement-facing and action-facing clear and natural.

## Equipment

Use one fixed sword-and-lantern loadout for the first playable.

Build attachment hooks so the equipment setup can support later expansion. Postpone visible armor swapping and multiple weapon animation sets until the core loadout and its animations are proven.

## World structure

Begin with small, connected, hand-authored areas and simple elevation.

Use these areas to prove the basic art and occlusion system. Defer procedural generation and stacked walkable floors until that foundation is reliable.

## Lighting

Use painted environmental lighting, simple contact shadows, and selective glow from the lantern and spells.

Keep full dynamic relighting optional. The initial visual direction should work with the painted lighting approach, with selective glow supporting readability and atmosphere.

## Prototype priorities

The first playable should prove the sword combo, recovery-only dodge cancellation, mouse-aimed lantern stagger, and movement/action facing transitions together in a small connected area. Art validation should establish that simple elevation, occlusion, contact shadows, and selective glow work coherently.

Stamina, a lantern resource economy, full aim-facing strafing, visible armor swaps, additional weapon animation sets, procedural generation, and stacked walkable floors are deferred. Full dynamic relighting remains an optional later direction.
