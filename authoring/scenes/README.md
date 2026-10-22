# Authored scenes

Save scene documents here through the [scene editor](../../docs/developer-tools.md#scene-editor). Scenes are replaceable prototype content; the registered orchard, clearing, forge, chapel, rootwood, village, graveyard, cloister, abbey and crypt documents supply Game content, while engine tests own independent fixtures.

Game starts in Abandoned Orchard, branching to Forest Gathering Clearing through its northwestern forest path and Ruined Craftsman Forge through its eastern gate. Forge’s northern street leads to Desecrated Chapel. The clearing’s northwestern path continues to Rootwood Clearing, then Ruined Village Paths and Graveyard Terraces. Chapel’s eastern side room leads to Cloister, whose eastern passage reaches Raven Abbey. Graveyard’s lower mausoleum approach leads into Crypt. Every passage has a matching return; the clearing has no forge departure. Open a draft in the editor and choose Play to run it without writing Game checkpoints. [Game content registration](../../docs/architecture.md#add-an-area-or-enemy) is a separate step. Sandbox rendering fixtures live in content code and are independent of this directory.

Saving a scene with ground interaction also retains an immutable revision under `authoring/ground-profiles/`. See [Saved ground profiles](../../docs/developer-tools.md#saved-ground-profiles) for restoration and artwork reassignment, and [scene design](../../docs/scene-design.md) for composition guidance and the starting painting scales.

## Orchard composition

The painted orchard remains the main environment. Its existing trees, fruit boxes, fallen timber, walls and cider press supply the landmarks; added props support four specific activities:

- **Camp verge:** split orchard packing boards feed the low fire beside the southern wall. The new orchard backpack rests against the same wall within its light and holds the Traveller’s Charm (+5 maximum health when equipped).
- **Harvest apron:** one scene-specific cider barrel stands beside the painted fruit boxes. The cart, loose sacks and driver’s roll have been removed; the eastern passage stays open.
- **Western picking station:** a matching picker’s basket sits beside the painted fruit box station. The basket holds salvaged iron, near the isolated western skeleton. The barrow and extra sacks have been removed.
- **Press apron:** a slatted breakable crate and the keeper’s packed crate sit beside the shed’s painted storage stack. The slatted crate supplies one recovery potion; the packed crate holds the Orchard Ring and Gold. Both use the orchard set’s supplied animation and permanent spent drawing. The smaller packing crates flank the painted storage stack without covering its frontage.

Each object's `purpose`, `label` and `zone` record its location. The props use their scene-specific native artwork and supplied ground registration, with sizes reviewed beside the hero and the painted storage containers. Small picking baskets, portable toolboxes and travel packs retain their hand-carried proportions. Low fires use spent scene-specific wooden props beneath the shared flame effect instead of freestanding metal braziers. Main dirt routes and fighting pockets remain open. Original collision and painted occlusion remain intact. Check the complete painting and each work area at gameplay scale after changes.

The entrance is free of enemies. The nine-unit arrival frame reveals the camp while keeping the first skeleton outside the opening view, then narrows to normal gameplay distance farther inside. The first skeleton waits in the open pocket west of the apple canopy, with room to dodge and a short pursuit leash. It becomes fully visible on the approach from camp before its awareness activates. The main route then meets the press pair and linked departure pair; the picking station is optional. Visible paths, supplies and enemy staging provide the opening guidance under [Game design](../../docs/game-design.md#opening-guidance). Most enemies carry no reward; the first drops one potion, departure yields gold and salvage, and optional supplies retain distinct uses.

## Clearing and forge composition

The clearing's southeastern bank holds an abandoned gatherers' rest: a low ochre canvas shelter encloses a sleeping bench, fuel and a hanging kettle. A provision hamper and small board fire occupy its open apron beside the foreground rock. The arrival reveals this complete group while the dirt fork remains open. A scene collision boundary blocks the foreground ledge's previously walkable rock top; the camp sits back from that edge. The shelter is one registered native drawing, preserved with its source and generation provenance; it establishes the camp's scale and purpose before the smaller supplies are added.

The clearing’s painted stairs, terraces and central island are walkable. Trees, rocks, the rear cliff and genuine scenery bases retain collision. Two independent skeleton encounters occupy the cache approach and western path; neither locks loot or departures. The ochre chest rewards a Gatherer’s Seal (+10 maximum health in the trinket slot). Silver hour preserves distant-ground readability. The southeastern trail returns to Orchard.

The spatial references were the caravan camp in [Death's Door](https://www.nintendolife.com/reviews/switch-eshop/deaths-door), Sarah Morris's [Stranded Sailor interior concept](https://www.conceptartassociation.com/2022-caa-finalists/stranded-sailor-interior-deaths-door), and the caravan yard pictured on the [Bastion store page](https://store.playstation.com/en-gb/product/EP4484-CUSA02057_00-BASTIONBUNDLE000). Their useful relationships are substantial shelter or architecture at the edge, supplies grouped at a usable station, and a quiet circulation or combat area. Lantern's original painting, palette and character artwork remain the visual source.

Ruined Craftsman Forge connects its western/southwestern approach to Orchard’s eastern gate and its northern street to Chapel. The workshop and accessible ruined-room floors are walkable; masonry, vegetation and solid rubble retain focused collision. A linked courtyard pair and separate northern watch create optional threats. The tool chest retains Gold, Iron, a potion and the Cinder Signet without a guard lock. Kit improvements remain available at every campfire, following [character progression](../../docs/game-design.md#character-progression).

On-foot arrivals use the matching passage beyond immediate exit activation range; campfire travel goes directly to discovered fires. Physical departures allow escape during combat. Rest resets encounters while claimed caches remain spent and permanent improvements remain owned. No loot or equipment collection determines a next destination.

## Desecrated Chapel composition

The southwestern doorway and threshold fire lead into the existing nave painting. The supplied Sepulcher Warden, an armored skeleton carrying a two-handed hammer, holds the central aisle; two faster attendants converge from the western and eastern side aisles under shared awareness. Their leashes span the nave so a flank approach does not cancel the opposite attendant’s alarm. Its body brightens once during the latter half of the committed windup, alongside the existing small foot accent; neither marks an attack area. It resists physical interruption but remains vulnerable to the lantern’s stagger. Use the aisle junctions to gather attendants, then separate from the slower warden. Its overhead hammer hold lasts until the committed windup ends; the fourth supplied attack drawing begins at the damage tick in all four attack facings. Its longer swing gives room to dodge and counter rather than repeatedly interrupting it with sword hits.

The optional stone altar coffer rewards the Vigil Amulet, potions and Gold once, using its supplied opening sequence and permanently opened drawing. It can be opened while enemies remain alive. The altar, main entrance stairs and accessible side-room floors are walkable; pews, column bases and perimeter walls retain collision. The threshold fire supports retries. The southwestern main entrance returns to Forge’s northern street.

The Vigil Amulet remains optional equipment. Collecting it does not initiate a return journey or change world access.

## Woodland composition

The travel pack rests at the stone footing of the northern ruined gatepost, off the trail. Its hand-carried size is reviewed beside the hero. Woodland uses Silver hour because its source painting already contains deep cool shade; this preserves readable ground beyond the stronger warm lantern pool. The clearing also uses Silver hour; Orchard, Forge and Chapel retain Lantern night. Game and the editor consume the same saved look.

## Rootwood, village and graveyard branch

Clearing’s northwestern path leads into Rootwood Clearing’s western approach. Silver hour keeps the deep painted foliage readable. A lone skeleton occupies the central fork, a linked melee pair holds the eastern detour, and a Candlebone Oracle covers the northern approach to the village. The western campfire supports retries; broad quiet ground separates arrival from the first fight. The northern route remains usable during pursuit.

Rootwood’s northern path meets the village’s southern trail. The arrival fire sits on the eastern verge. A lone square sentry introduces the open fighting area; an Oracle and faster attendant share awareness farther up the hearth apron. A separate cottage straggler makes the western steps an optional detour. A mason’s toolbox beside the hearth contains repair iron and a potion, accessible without defeating the pair. The northern trail continues to Graveyard Terraces.

Graveyard arrives at the western stair landing, with a fire on the central terrace. A lone skeleton occupies the curving descent; farther down, a linked skeleton attendant and armored hammer warden hold the lower mausoleum court. The court’s open apron provides room to dodge the committed swing and counter with sword or lantern. The gravekeeper’s coffer holds Gold, potions and a damaged axe; it opens independently of combat and remains spent after rest. A focused collision footprint keeps the lower court’s corner post out of the walking route. The western stairs return to the village.

All three areas reuse supplied paintings, existing enemy drawings and registered container artwork. Camps, enemies and containers reserve clear artwork envelopes. Movement review covers the authored approaches, both directions of each passage, the lower graveyard court and the usable fronts of both containers.

## Cloister, abbey and crypt encounters

Chapel’s eastern side room opens into Cloister’s northwestern courtyard. The refuge fire sits in a clear pocket beside the western statue approach. A lone skeleton holds the western crossing; a Candlebone Oracle covers the northern gallery approach, while a separate armored warden occupies the southern statue apron. The broad central court lets the player choose the order and retreat between fights. The eastern passage leads to Raven Abbey without requiring a kill or reward.

Raven Abbey arrives through the southern entrance, with a gatefire on the eastern verge. A skeleton watches the planter’s northern passage, leaving the southern loop open for retreat. A separate hammer warden holds the open apron below the cooking shelter. Silver hour keeps the tree, shelter and enemy silhouettes readable across this smaller courtyard. The southern entrance returns to Cloister.

Graveyard’s lower mausoleum approach leads into Crypt’s western aisle. An antechamber fire supports retries before the central crossing. A lone crossing sentry introduces the space; the northern aisle’s straggler is an optional salvage detour. A linked Oracle and attendant occupy the eastern shrine approach, while an independent hammer keeper holds the southern aisle. The pillar islands divide lines of approach without closing the central crossing. The western aisle returns to Graveyard, including during pursuit.

These areas reuse supplied paintings, registered enemy artwork and the shared stone-ring fires. Enemies drop modest salvage and recovery supplies; no new equipment or collection gate controls travel. Arrival points remain beyond immediate return-passage activation, and rest restores encounters. Inspect the arrival, fire, approach and return views at gameplay scale; clear placement envelopes and reachable routes remain separate from visual acceptance.
