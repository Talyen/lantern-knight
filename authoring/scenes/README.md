# Authored scenes

Save scene documents here through the [scene editor](../../docs/developer-tools.md#scene-editor). Scenes are replaceable prototype content; no document is required for Game startup or engine tests.

Game currently starts with an empty floor and the hero. Open a draft in the editor and choose Play to run it without writing Game checkpoints. [Game content registration](../../docs/architecture.md#add-an-area-or-enemy) is a separate step. Sandbox rendering fixtures live in content code and are independent of this directory.

Saving a scene with ground interaction also retains an immutable revision under `authoring/ground-profiles/`. See [Saved ground profiles](../../docs/developer-tools.md#saved-ground-profiles) for restoration and artwork reassignment, and [scene design](../../docs/scene-design.md) for composition guidance and the starting painting scales.
