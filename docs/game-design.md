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

Gold, Health Potions, Materials and damaged equipment form the initial reward loop. Damaged equipment is labeled Salvage only and converts to the displayed materials through inventory outside combat. Broader item effects and upgrades beyond the first forge choice remain to be designed. Visible armor swapping and additional weapon animation sets are not current roadmap commitments.

## Character progression

The opening offers one permanent choice at a reachable courtyard workbench in Ruined Craftsman Forge. Gold, Iron and a unique Workshop Temper fund the purchase; equipment continues to add maximum health. Bone remains reserved for a later recipe.

Use three explicit attributes: Vitality raises maximum health, Edge scales direct physical sword damage, and Ember scales lantern initial-hit and Burn damage together. Keep attack timing, dodge protection, lantern radius, cooldown and stagger fixed so upgrades preserve learned combat cues. Start at Vitality 100, Edge 100% and Ember 100%; existing health equipment adds to Vitality. Defer character levels, XP and freely allocated stat points until the first choice proves useful.

At the courtyard workbench, offer **Temper Sword** (+100% Edge) or **Rekindle Lantern** (+100% Ember), each costing 20 Gold and 4 Iron. The first purchase consumes one unique workshop temper recovered from the guarded forge cache, so the opening permits one choice even if the player collected every optional cache. Show current and resulting damage, exact costs, and a confirmation before spending. A second purchase and respec remain out of scope for this slice. Round final damage to the nearest integer once at the combat boundary, with a minimum of one; apply Ember to each Burn tick without changing its cadence. With the current base damage, Temper Sword changes 26 to 52; Rekindle Lantern changes the initial hit from 16 to 32 and each of three Burn ticks from 4 to 8. These prototype defaults create distinct payoffs against the opening’s 50-health thralls: one direct sword impact or one Flare followed by all three Burn ticks. A baseline sword takes two impacts, while a baseline Flare leaves 22 health after its full Burn. Keep the initial encounters and action timing unchanged; the earned choice strengthens the return journey. Show those resulting values rather than promising an exact percentage after rounding.

Retain current equipment slots, with only rings and trinkets granting health bonuses in the opening. The Orchard Ring grants +10 and the clearing's Gatherer's Seal grants +10 in the trinket slot, replacing the optional +5 Traveller's Charm. Sword and lantern upgrades belong to the permanent kit, not removable item copies. Keep body, gloves, belt, boots and amulet cosmetic until they have deliberate effects and readable comparisons. Salvaging damaged axes produces 2 Iron; damaged helmets produce 1 Iron and 1 Bone. Reserve Bone for a later authored recipe; do not add a spending requirement merely to consume it.

Budget the mandatory clearing encounter and forge cache to cover the first purchase without farming: clearing guards supply 8 Gold and two axes (4 Iron after salvage), and the forge cache supplies 20 Gold and 6 Iron. Optional orchard rewards allow earlier healing and equipment discovery without being a prerequisite. The cache supplies one unique Workshop Temper. Rest must never regenerate caches, tempers or permanent upgrades; ordinary enemy drops must not bypass the unique purchase limit.

Persist the chosen upgrade, unique temper ownership and resource balances atomically before accepting the purchase in the live session. Cancelled or failed purchases consume nothing; repeated activation cannot buy twice. Death retains earned resources, claimed caches, equipment and upgrades while retrying enemies. Acceptance requires both upgrade choices to change their intended damage only, a visible before/after comparison, save/resume and death retention, and no duplicate reward or purchase after reload.

## World structure

Author small destinations in the scene editor. Game begins in Abandoned Orchard, with explicit departures through Forest Gathering Clearing to Ruined Craftsman Forge. Discovering campfires unlocks travel between them. Rest heals and resets enemies without replenishing potions or restoring claimed objects. Death retains rewards and returns to the nearest reachable discovered campfire in the current destination, or the last visited fire when none is reachable. Scene-editor playtests run authored content in temporary sessions.

On-foot returns arrive at the matching path rather than skipping to the destination campfire. Rest before retracing the opening to try the permanent upgrade against restored encounters. Campfire travel remains the direct route between discovered fires.

The forge’s northern street leads to Desecrated Chapel. Its entrance fire anchors an optional encounter in the nave: a large, rose-tinted altar warden and two faster attendants share awareness across the side aisles. The warden has 130 health, a one-second windup and an 18-damage swing. Physical hits deal full damage without interrupting its action; the lantern pulse still staggers it. Attendants retain 50 health and close faster than the warden. All three guard a one-time reliquary containing the Vigil Amulet (+15 maximum health in the amulet slot), two potions and Gold. The raised altar remains blocked.

Temper Sword defeats an attendant in one impact and reduces the warden from five sword impacts to three. Rekindle Lantern defeats gathered attendants with one complete Burn and creates an opening against the warden. Neither choice is required for entry, and neither damage type gains a weakness multiplier. Keep the threshold retreat open: rest resets the vigil while retaining claimed rewards, and death uses the discovered threshold fire. The return arrives inside the forge’s northern street.

Traversal, combat, artwork and occlusion are capabilities independent of a particular level composition. Further destinations and encounters remain to be designed.

## Lighting

Use painted environmental lighting, simple contact shadows and selective glow from the lantern and spells.

Keep full dynamic relighting optional. The initial visual direction should work with the painted lighting approach, with selective glow supporting readability and atmosphere.

## Opening guidance

Let the environment introduce the journey: abandoned belongings and surviving fires suggest the way forward. Keep the ring detour optional and departure tied to its specific guards. The clearing offers another fire and a paired encounter at the foot of the ritual ruins. Its guarded cache holds a Gatherer’s Seal, and defeating the pair opens the northwestern route to the forge. The central island splits the approach, encouraging positioning and a lantern burst when the pair closes in. The forge offers a surviving courtyard fire, guarded salvage and a reachable workbench for the first permanent kit choice; the raised workshop remains blocked pending authored elevation.

Keep gameplay UI quiet: health and owned potion counts, a short interaction cue anchored near the usable object, and brief outcome or failure feedback. Remove tutorial windows, persistent objective text and action/control strips. Full controls remain in pause/help. Existing checkpoint hint history remains compatible, without an onscreen hint replay flow.

Guide with clustered supplies, open walking space, warm resting-place light, enemy staging and occasional low drifting leaves. The opening wind suggests the nearby supplies or forest path; in the clearing it suggests the ruins, then the forge path. At the forge it suggests the guarded tool chest and its dropped rewards, then the courtyard workbench until an upgrade is chosen, then the chapel path until the Vigil Amulet is collected. Chapel wind suggests the reliquary and its dropped rewards, then the threshold fire; returning to the forge with the amulet suggests its fire. It follows walkable routes, pauses during combat, and respects the wind setting and reduced motion. It neither steers the hero nor closes optional routes. Test whether players notice the direction without mistaking the leaves for loot or a mandatory trail.

Barrels belong with orchard storage; household pottery belongs by the ruined storehouse. Resting fires gather a bedroll and kindling. Tie caches and forward paths to named local guards; keep the return path available. Use the supplied dark fire bowl and animation, preserving source artwork. The hero's continuous lantern light uses a stronger, wider pool with a soft falloff; keep enemy silhouettes and painted scenery readable within it.

Enemy cues use supplied animation with a restrained windup accent, without ground attack zones. Show the burst radius and a subdued persistent Burn cue. Burn ticks do not repeat full contact effects or impact sounds.

## Prototype priorities

Polish alternating sweep/lunge attacks, dodge, the Burn lantern special and movement/action facing transitions together in authored prototype areas. Complete enemy action animation and attack cues, coherent hit/Burn feedback, sound and music, basic onboarding and settings usability.

Art validation should establish that elevation, occlusion, contact shadows and selective glow work coherently. Visible playtesting should confirm that a new player understands the controls, reads enemy actions, uses both attacks meaningfully, traverses connected authored areas, retries after death and saves/resumes reliably.

Follow this with a cohesive progression loop before expanding the adventure. Validate the lantern, Burn and cancellation defaults through visible playtesting, then resolve progression relationships before implementation; the [roadmap](roadmap.md) tracks the work.

## Presentation and delivery defaults

Game, Dev Preview and new authoring scenes default to Lantern night / Dark cinematic, sun direction 20° and elevation 15°, 100% light response and no depth-of-field blur. Authored scenes can override their rig, look and sun. Saved player settings can restore depth of field, and Dev Preview can retain experiments across reloads. All three light rigs and looks remain available for authoring. [Scene design](scene-design.md#scene-cohesion) explains the production treatment; [lighting profiles](../src/presentation/lighting-profiles.ts) own the rendering defaults and [new scene defaults](../src/editor/default-scene.ts) own initial authoring values.

The camera retains 45 degree azimuth, full-precision 35.264389682754654 degree elevation and 9 m initial vertical span under the [camera contract](../src/assets/camera-contract.ts).

Use supplied eight-direction running and four-direction idle/action artwork for the immediate hero kit. Further action direction coverage and a future controlled 3D or 2D production route remain open; the original briefs do not impose an eight-direction or rig requirement. The selected animation treatment combines stabilization, guarded motion warp, rigid-sword protection, weighted walk rhythm and directed action holds. Action lengths and gameplay windows are shared across headings; preserve deliberate loading and impact holds. Artwork registration changes only presentation; simulation remains authoritative for actions, damage and movement.

Windows is the primary delivery target, with macOS development support. Establish packaged 2560 x 1440 at 60 FPS on named reference hardware before making performance claims. 120 FPS remains a stretch goal.
