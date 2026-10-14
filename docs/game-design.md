# Lantern Knight — Design Intent

This document records the intended direction for the prototype and first playable. It describes design targets, not a claim that these features are already implemented. The [roadmap](roadmap.md) tracks existing capabilities and upcoming work. Exact timings, ranges and balance values remain open for playtesting.

## Combat feel

Combat should feel deliberate but responsive. Basic sword attacks alternate between sweep and lunge, with readable commitment and clear opportunities to react between actions.

Sword windups and active damage windows stay committed. Sword, lantern, dodge and movement can interrupt recovery after impact resolves. One queued action preserves the newest usable request; unavailable requests and movement do not replace it. Dodge travel and invulnerability remain protected, while requests during hurt wait for the reaction to finish. Incoming interruption, death, load and room replacement clear queued input.

Start without a stamina system. Tune attack timing, input buffering, dodge timing and aiming together with the action animations.

## Player action feedback

Every supported player action should receive timely, perceivable acknowledgment and communicate its outcome visually. Essential meaning must remain understandable with sound muted; audio can reinforce it. Apply this principle to gameplay and UI design, implementation and review.

Reuse existing movement, action animation, focus/selection, cooldown indicators and status messages before adding effects. Make accepted, buffered and unavailable actions distinguishable where that affects the player's next decision; a queued attack must not look like an immediate hit or a rejected input like a successful cast. Unbound keys and noninteractive scenery require no response.

For delayed operations such as save/load, acknowledge pending work promptly, then communicate completion or failure without a success cue on failure. Pointer and keyboard interaction should communicate equivalent outcomes. Review combat polish and checkpoint flows against these expectations; this principle does not claim that every planned cue is already implemented or alter simulation timing.

## Damage types and Burn

Sword and enemy melee deal Physical damage. The lantern deals an initial Burn hit and applies a Burn status. Opening enemies are neutral to both types; weaknesses wait for a later, visibly distinct enemy.

Repeated Burn applications refresh one DoT without stacking or postponing its next tick. Initial tuning is 4 damage each second for 3 seconds. Ticks never cause hurt reactions or stagger; a Burn defeat awards ordinary rewards once. Status timers freeze while paused or in an inactive destination, survive checkpoints and revisits, and clear when encounters reset. Future weakness modifiers should affect the initial hit and ticks together.

## Lantern ability

The lantern is a circular burst centered on the hero at impact. Mouse aim selects the supplied casting animation's facing, independently of targeting. Preserve obstruction and height checks; only enemies receive the burst, while crates retain their sword interaction.

Start with a 2.5 m radius, a four-second cooldown beginning when casting starts, a 0.2-second visible lift, 16 initial Burn damage and half a second of stagger. Fire once when the lantern reaches its raised pose. Recovery becomes cancellable only after that pulse resolves. Keep gameplay and runtime animation timing together without regenerating the supplied artwork.

These are playtest defaults, not balance approval. The burst creates room to reposition and supports a sword follow-up; damage over time does not repeatedly interrupt enemies. Use cooldown only, without consumable charges.

## Movement and facing

Face the direction of travel while moving. Face the mouse aim direction for sword attacks and lantern casting.

Defer full aim-facing strafing initially: it requires additional animation work. The first playable should make the transition between movement-facing and action-facing clear and natural.

## Equipment

Keep the hero artwork fixed. Equipment supports Leather/Cloth body armor, gloves, belt, boots, two rings, amulet, trinket, sword and lantern. The opening ring grants 10 maximum health without healing on equip.

Gold, Health Potions, Materials and damaged equipment form the initial reward loop. Damaged equipment is labeled Salvage only and converts to the displayed materials through inventory outside combat. Broader item effects and permanent upgrades remain to be designed. Visible armor swapping and additional weapon animation sets are not current roadmap commitments.

## Character progression

Design levels/stats, equipment/loot and permanent upgrades as one cohesive system. Favor authored rewards and deliberate build choices. Define attributes, equipment slots, reward cadence and how rewards feed each progression layer before implementation.

Begin with a minimal integrated progression loop in authored prototype content, including player-facing choices and persistent state. Retain earned progression on death and retry the encounter.

## World structure

Author small destinations in the scene editor. Game begins in Abandoned Orchard, with an explicit departure to Forest Gathering Clearing. Discovering campfires unlocks travel between them. Rest heals and resets enemies without replenishing potions or restoring claimed objects. Death retains rewards and returns to the nearest reachable discovered campfire in the current destination, or the last visited fire when none is reachable. Scene-editor playtests run authored content in temporary sessions.

Traversal, combat, artwork and occlusion are capabilities independent of a particular level composition. Future destinations and encounters remain to be designed.

## Lighting

Use painted environmental lighting, simple contact shadows and selective glow from the lantern and spells.

Keep full dynamic relighting optional. The initial visual direction should work with the painted lighting approach, with selective glow supporting readability and atmosphere.

## Opening guidance

Let the environment introduce the journey: abandoned belongings and surviving fires suggest the way forward. Keep the ring detour optional and departure tied to its specific guards. The clearing offers another fire, ruins to explore, and a reason to return for rest or travel.

Keep gameplay UI quiet: health and owned potion counts, a short interaction cue anchored near the usable object, and brief outcome or failure feedback. Remove tutorial windows, persistent objective text and action/control strips. Full controls remain in pause/help. Existing checkpoint hint history remains compatible, without an onscreen hint replay flow.

Guide with clustered supplies, open walking space, warm resting-place light, enemy staging and occasional low drifting leaves. The opening wind suggests the nearby supplies or forest path; in the clearing it suggests the ruins, then the fire. It follows walkable routes, pauses during combat, and respects the wind setting and reduced motion. It neither steers the hero nor closes optional routes. Test whether players notice the direction without mistaking the leaves for loot or a mandatory trail.

Barrels belong with orchard storage; household pottery belongs by the ruined storehouse. Resting fires gather a bedroll and kindling. Keep loot amounts, guard conditions and encounter counts intact. Use the supplied dark fire bowl and animation, preserving source artwork. The hero's continuous lantern light uses a stronger, wider pool with a soft falloff; keep enemy silhouettes and painted scenery readable within it.

Enemy cues use supplied animation with a restrained windup accent, without ground attack zones. Show the burst radius and a subdued persistent Burn cue. Burn ticks do not repeat full contact effects or impact sounds.

## Prototype priorities

Polish alternating sweep/lunge attacks, dodge, the Burn lantern special and movement/action facing transitions together in authored prototype areas. Complete enemy action animation and attack cues, coherent hit/Burn feedback, sound and music, basic onboarding and settings usability.

Art validation should establish that elevation, occlusion, contact shadows and selective glow work coherently. Visible playtesting should confirm that a new player understands the controls, reads enemy actions, uses both attacks meaningfully, traverses connected authored areas, retries after death and saves/resumes reliably.

Follow this with a cohesive progression loop before expanding the adventure. Validate the lantern, Burn and cancellation defaults through visible playtesting, then resolve progression relationships before implementation; the [roadmap](roadmap.md) tracks the work.

## Presentation and delivery defaults

Game, Dev Preview and new authoring scenes default to Silver hour / Dark cinematic, sun direction 20° and elevation 15°, and 150% light response. Authored scenes can override their rig, look and sun; Dev Preview can retain experiments across reloads. Both light rigs and all three looks remain available for authoring. Depth of field and saved visual preferences keep their existing behavior. The camera retains 45 degree azimuth, full-precision 35.264389682754654 degree elevation and 9 m initial vertical span. [Lighting profiles](../src/presentation/lighting-profiles.ts) and the [camera contract](../src/assets/camera-contract.ts) own the current defaults.

Use supplied eight-direction running and four-direction idle/action artwork for the immediate hero kit. Further action direction coverage and a future controlled 3D or 2D production route remain open; the original briefs do not impose an eight-direction or rig requirement. The selected animation treatment combines stabilization, guarded motion warp, rigid-sword protection, weighted walk rhythm and directed action holds. Action lengths and gameplay windows are shared across headings; preserve deliberate loading and impact holds. Artwork registration changes only presentation; simulation remains authoritative for actions, damage and movement.

Windows is the primary delivery target, with macOS development support. Establish packaged 2560 x 1440 at 60 FPS on named reference hardware before making performance claims. 120 FPS remains a stretch goal.
