# Authored scenes

Save scene documents here through the [scene editor](../../docs/developer-tools.md#scene-editor). Scenes are replaceable prototype content; the selected orchard and clearing documents supply Game content, while engine tests own independent fixtures.

Game starts in Abandoned Orchard and travels to Forest Gathering Clearing. Open a draft in the editor and choose Play to run it without writing Game checkpoints. [Game content registration](../../docs/architecture.md#add-an-area-or-enemy) is a separate step. Sandbox rendering fixtures live in content code and are independent of this directory.

Saving a scene with ground interaction also retains an immutable revision under `authoring/ground-profiles/`. See [Saved ground profiles](../../docs/developer-tools.md#saved-ground-profiles) for restoration and artwork reassignment, and [scene design](../../docs/scene-design.md) for composition guidance and the starting painting scales.

## Orchard composition

The painted orchard remains the main environment. Its existing trees, fruit boxes, fallen timber, walls and cider press supply the landmarks; added props support four specific activities:

- **Camp verge:** a surviving fire and unused kindling sit behind bedding pulled toward the southern gate. A traveller’s satchel sits on the approach side of the bedding, catching the firelight: someone abandoned packing while the fire was still burning. The satchel holds a Traveller’s Charm (+5 maximum health when equipped in the trinket slot).
- **Harvest apron:** a parked wooden handcart, one cider barrel, tied sack and driver's roll sit below the painted harvest boxes. The eastern passage stays open and quiet; the driver’s roll is scenery rather than another reward cache.
- **Western picking station:** a wooden wheelbarrow, spare picking crate, sack and worker's bag relate to the existing empty fruit box and fallen timber. They leave the western approach available for fighting. One isolated skeleton guards salvaged iron here as an optional detour.
- **Press apron:** a packing crate, small supply sack and keeper's tool roll extend the shed's illustrated storage stack. The painting already supplies the press and larger equipment; added furniture would crowd its approach. Two skeletons guard the keeper’s tools and Orchard Ring; the packing crate supplies one recovery potion. No freestanding treasure chests or decorative scatter remain.

Each object's `purpose`, `label` and `zone` record its role. Keep those descriptions specific to its actual location. The main dirt routes stay open, supplies remain fully visible and enemies stand in clear pockets; neither painted cover nor a numerical encounter target justifies hiding gameplay. Check the complete painting and each work area at gameplay scale after changes. Original collision remains intact. The harvest-apron bush has a native-contour mask and depth boundary, so it covers the rear of the parked handcart and nearby driver’s roll.

The entrance is free of enemies. The nine-unit arrival frame reveals the camp while keeping the first skeleton outside the opening view, then narrows to normal gameplay distance farther inside. The first skeleton waits in the open pocket west of the apple canopy, with room to dodge and a short pursuit leash. It becomes fully visible on the approach from camp before its awareness activates. The main route then meets the press pair and linked departure pair; the picking station is optional. Guiding wind suggests the nearby abandoned satchel, the first enemy, the press supplies and their dropped reward, then departure. It yields during combat, allows the camp and first encounter to be bypassed, and does not rewind after resting once the press supplies are claimed. Most enemies carry no reward; the first drops one potion, departure yields gold and salvage, and optional supplies retain distinct uses.
