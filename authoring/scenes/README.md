# Authored scenes

Save scene documents here through the [scene editor](../../docs/developer-tools.md#scene-editor). Scenes are replaceable prototype content; the selected orchard and clearing documents supply Game content, while engine tests own independent fixtures.

Game starts in Abandoned Orchard and travels to Forest Gathering Clearing. Open a draft in the editor and choose Play to run it without writing Game checkpoints. [Game content registration](../../docs/architecture.md#add-an-area-or-enemy) is a separate step. Sandbox rendering fixtures live in content code and are independent of this directory.

Saving a scene with ground interaction also retains an immutable revision under `authoring/ground-profiles/`. See [Saved ground profiles](../../docs/developer-tools.md#saved-ground-profiles) for restoration and artwork reassignment, and [scene design](../../docs/scene-design.md) for composition guidance and the starting painting scales.

## Orchard composition

The painted orchard remains the main environment. Its existing trees, fruit boxes, fallen timber, walls and cider press supply the landmarks; added props support four specific activities:

- **Camp verge:** a small fire, folded bedding, kindling and a traveller's satchel share a grassy pocket inside the southern entrance, beside the track.
- **Harvest apron:** a parked wooden handcart, one cider barrel, tied sack and driver's roll sit below the painted harvest boxes. The eastern passage stays open.
- **Western picking station:** a wooden wheelbarrow, spare picking crate, sack and worker's bag relate to the existing empty fruit box and fallen timber. They leave the western approach available for fighting.
- **Press apron:** a packing crate, small supply sack and keeper's tool roll extend the shed's illustrated storage stack. The painting already supplies the press and larger equipment; added furniture would crowd its approach. Loot belongs to these supplies; no freestanding treasure chests or decorative scatter remain.

Each object's `purpose`, `label` and `zone` record its role. Keep those descriptions specific to its actual location. The main dirt routes stay open, supplies remain fully visible and enemies stand in clear pockets; neither painted cover nor a numerical encounter target justifies hiding gameplay. Check the complete painting and each work area at gameplay scale after changes. Original collision and occlusion profiles remain intact.
