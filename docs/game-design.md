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

A cursor over a living enemy's body aims toward that enemy's feet, rather than projecting its torso onto the floor behind it. Use a narrow upright body capsule, excluding weapons; dead enemies, obstructed enemies and enemies on a different walking elevation do not capture aim. Empty ground retains free mouse aiming. This changes facing only: combat still enforces range, attack arcs, obstruction and elevation.

Defer full aim-facing strafing initially: it requires additional animation work. The first playable should make the transition between movement-facing and action-facing clear and natural.

## Equipment

Keep the hero artwork fixed. Equipment supports Leather/Cloth body armor, gloves, belt, boots, two rings, amulet, trinket, sword and lantern. The opening Orchard Ring grants 10 maximum health; the Traveller’s Charm grants 5 in the trinket slot. Neither heals on equip.

Gold, Health Potions, Materials and damaged equipment form the initial reward loop. Damaged equipment is labeled Salvage only and converts to the displayed materials through inventory outside combat. Broader item effects and upgrades beyond the initial kit ranks remain to be designed. Visible armor swapping and additional weapon animation sets are not current roadmap commitments.

Inventory presents a compact equipped kit, a grouped pack and one selected-item comparison. Show the replacement and resulting maximum health before equipping; choosing a ring destination updates that comparison. Keep equipment actions visible while item descriptions scroll. At compact widths, switch between kit and pack while keeping the selected comparison visible. Salvage previews show the selected stack yield and the combined yield for all damaged equipment.

## Character progression

Permanent kit improvements belong to the player and are available at every campfire. Equipment supplies the opening's maximum-health bonuses. Bone remains reserved for a later deliberate recipe; broader item effects and higher upgrade ranks need design.

### Universal upgrades

Inspect the shared catalog through Upgrade kit in inventory anywhere outside combat. To buy, interact with any reachable campfire and choose Upgrade kit. Opening the panel and buying an improvement do not heal the hero or reset encounters; Rest is separate. No recipe depends on a scene, workbench, container or discovered destination. The forge workbench remains scenery.

Start with two independent improvements, each capped at rank I: **Temper Sword I** raises Edge from 100% to 200%; **Rekindle Lantern I** raises Ember from 100% to 200%. Each costs 20 Gold and 4 Iron. Buying one leaves the other available for a later purchase. The opening supports neither, either or both; there is no exclusive branch or special upgrade currency. Higher ranks, respec, character levels, XP and freely allocated stat points remain outside this version.

Vitality is maximum health, Edge scales direct physical sword damage, and Ember scales the lantern initial hit and every Burn tick together. Base Vitality is 100 and equipment adds health without healing on equip. Keep action timing, dodge protection, lantern radius, cooldown and stagger fixed so improvement preserves learned combat cues. Round final damage once at the combat boundary, with a minimum of one. Temper Sword changes 26 to 52 damage per impact. Rekindle Lantern changes the initial hit from 16 to 32 and each of three Burn ticks from 4 to 8, for 56 total per enemy. These are prototype tuning values. A baseline sword takes two hits against a 50-health thrall; the improved sword takes one. Baseline Flare leaves 22 health after Burn; improved Flare defeats it after the full Burn.

Show owned rank, current and resulting damage, exact owned/required costs and confirmation before spending. Explain missing materials, maximum rank and the need to visit a fire. Put the damage breakdown behind a disclosure. Purchases persist through death, rest, travel, equipment swaps and reload. Save the complete candidate before accepting the change; failed or cancelled purchases consume nothing, and repeated activation cannot buy a rank twice. [Saved-state ownership](architecture.md#change-saved-state) owns admission and atomic persistence.

The mandatory clearing pair supplies 20 Gold and two damaged axes (4 Iron after salvage), covering either first improvement without requiring the forge cache or optional orchard supplies. The guarded forge cache adds 20 Gold and 6 Iron; optional exploration or repeated encounters can also fund improvements. Claimed caches never refill on rest, while ordinary enemy rewards remain repeatable. Finite rank caps bound power. Check the chapel with neither, either and both improvements before changing these costs or adding ranks. The tradeoff is less build exclusivity in exchange for a useful permanent reward loop across destinations.

Retain current equipment slots. The Orchard Ring grants +10 health; the clearing's Gatherer's Seal grants +10 in the trinket slot, replacing the optional +5 Traveller's Charm; the chapel's Vigil Amulet grants +15 in the amulet slot. Sword and lantern improvements belong to the kit rather than removable item copies. Body, gloves, belt and boots stay cosmetic until effects and comparisons are designed. Damaged axes salvage to 2 Iron; damaged helmets yield 1 Iron and 1 Bone. Do not add a spending requirement solely to consume Bone.

## World structure

Author small destinations in the scene editor. Game begins in Abandoned Orchard, with explicit departures through Forest Gathering Clearing to Ruined Craftsman Forge. Discovering campfires unlocks travel between them. Rest heals and resets enemies without replenishing potions or restoring claimed objects. Death retains rewards and returns to the nearest reachable discovered campfire in the current destination, or the last visited fire when none is reachable. Scene-editor playtests run authored content in temporary sessions.

On-foot returns arrive at the matching path rather than skipping to the destination campfire. Rest before retracing the opening to try the permanent upgrade against restored encounters. Campfire travel remains the direct route between discovered fires.

The forge’s northern street leads to Desecrated Chapel. Its entrance fire anchors an optional encounter in the nave: a large armored, hammer-bearing altar warden and two faster attendants share awareness across the side aisles. Their pursuit leashes cover the whole linked encounter, including an alarm raised from either flank; the threshold fire still breaks pursuit. The warden has 130 health, a one-second windup and an 18-damage swing. Physical hits deal full damage without interrupting its action; the lantern pulse still staggers it. Attendants retain 50 health and close faster than the warden. All three guard a one-time reliquary containing the Vigil Amulet (+15 maximum health in the amulet slot), two potions and Gold. The raised altar remains blocked.

Temper Sword I defeats an attendant in one impact and reduces the warden from five sword impacts to three. Rekindle Lantern I defeats gathered attendants with one complete Burn and creates an opening against the warden. Neither improvement is required for entry, and neither damage type gains a weakness multiplier. Keep the threshold retreat open: rest resets the vigil while retaining claimed rewards, and death uses the discovered threshold fire. The return arrives inside the forge’s northern street.

Traversal, combat, artwork and occlusion are capabilities independent of a particular level composition. Further destinations and encounters remain to be designed.

## Lighting

Use painted environmental lighting, simple contact shadows and selective glow from the lantern and spells.

Keep full dynamic relighting optional. The initial visual direction should work with the painted lighting approach, with selective glow supporting readability and atmosphere.

## Opening guidance

Let the environment introduce the journey: abandoned belongings and surviving fires suggest the way forward. Keep the ring detour optional and departure tied to its specific guards. The clearing offers another fire and a paired encounter at the foot of the ritual ruins. Its guarded cache holds a Gatherer’s Seal, and defeating the pair opens the northwestern route to the forge. The central island splits the approach, encouraging positioning and a lantern burst when the pair closes in. The forge offers a surviving courtyard fire, guarded salvage and permanent kit improvements at its campfire; the raised workshop remains blocked pending authored elevation.

Keep gameplay UI quiet: health and owned potion counts, a short interaction cue anchored near the usable object, and brief outcome or failure feedback. Show a compact lantern recharge meter and remaining seconds during recharge, or Ready during combat; hide the readout when ready outside combat. Before the player first uses the lantern, show its contextual prompt only during combat with a reachable enemy in burst range and the ability ready. Hide both lantern cues during pause, loading, death or an open adventure dialog. Avoid tutorial windows, persistent objective text and action/control strips. Full controls remain in pause/help. Existing checkpoint hint history remains compatible, without an onscreen hint replay flow.

Guide with clustered supplies, open walking space, warm resting-place light, enemy staging and occasional low drifting leaves. The opening wind suggests the nearby supplies or forest path; in the clearing it suggests the ruins, then the forge path. At the forge it suggests the guarded tool chest and its dropped rewards, then the chapel path until the Vigil Amulet is collected. Chapel wind suggests the reliquary and its dropped rewards. Once the Vigil Amulet is collected, it follows the matching return paths through forge and clearing to Orchard Campfire, even if optional caches were skipped. Loose rewards from already opened containers take precedence; ordinary enemy coins do not turn the journey around. It follows walkable routes, pauses during combat, and respects the wind setting and reduced motion. It neither steers the hero nor closes optional routes. Test whether players notice the direction without mistaking the leaves for loot or a mandatory trail.

Barrels belong with orchard storage; household pottery belongs by the ruined storehouse. Resting fires gather a bedroll and kindling. Tie caches and forward paths to named local guards; keep the return path available. Use the supplied dark fire bowl and animation, preserving source artwork. The hero's continuous lantern light uses a stronger, wider pool with a soft falloff; keep enemy silhouettes and painted scenery readable within it.

Enemy cues use supplied animation with a restrained windup accent, without ground attack zones. Show the burst radius and a subdued Burn cue. During an enemy windup, the attack accent takes priority over Burn; the status accent resumes at impact. Burn ticks do not repeat full contact effects or impact sounds.

## Prototype priorities

Polish alternating sweep/lunge attacks, dodge, the Burn lantern special and movement/action facing transitions together in the connected opening. Review enemy action animation and attack cues, hit/Burn feedback, contextual guidance and settings usability during the [opening playtest](verification.md#opening-playtest). Complete the [audio listening pass](sound-design.md#listening-and-tuning); music remains deferred.

Art validation should establish that elevation, occlusion, contact shadows and selective glow work coherently. Visible playtesting should confirm that a new player understands the controls, reads enemy actions, uses both attacks meaningfully, traverses connected authored areas, retries after death and saves/resumes reliably.

Validate campfire improvements through ordinary play, including earning materials, buying either path first and eventually both, and retaining purchases through death and save/resume. Use observed play to revisit the lantern, Burn and cancellation defaults before expanding progression or the adventure; the [roadmap](roadmap.md) tracks acceptance.

## Presentation and delivery defaults

Game, Dev Preview and new authoring scenes default to Lantern night / Dark cinematic, sun direction 20° and elevation 15°, 100% light response and no depth-of-field blur. Authored scenes can override their rig, look and sun. Saved player settings can restore depth of field, and Dev Preview can retain experiments across reloads. All three light rigs and looks remain available for authoring. [Scene design](scene-design.md#scene-cohesion) explains the production treatment; [lighting profiles](../src/presentation/lighting-profiles.ts) own the rendering defaults and [new scene defaults](../src/editor/default-scene.ts) own initial authoring values.

The camera retains 45 degree azimuth, full-precision 35.264389682754654 degree elevation and 9 m initial vertical span under the [camera contract](../src/assets/camera-contract.ts).

Use supplied eight-direction running and four-direction idle/action artwork for the immediate hero kit. Further action direction coverage and a future controlled 3D or 2D production route remain open; the original briefs do not impose an eight-direction or rig requirement. The selected animation treatment combines stabilization, guarded motion warp, rigid-sword protection, weighted walk rhythm and directed action holds. Action lengths and gameplay windows are shared across headings; preserve deliberate loading and impact holds. Artwork registration changes only presentation; simulation remains authoritative for actions, damage and movement.

Windows is the primary delivery target, with macOS development support. Establish packaged 2560 x 1440 at 60 FPS on named reference hardware before making performance claims. 120 FPS remains a stretch goal.
