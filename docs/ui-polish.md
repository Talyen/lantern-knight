# Player interface polish

## Design study

The first implementation milestone compares three inventory layouts before selecting a production shell: **A — The workbench** (centered), **B — The field pack** (right drawer), and **C — The open road** (split panels). All use the same existing artwork, sample contents, fixed 12 × 16 pack, and stable selected-item details. The mockups are a review artifact, not a shipping interface or gameplay implementation.

Build a portable study from the accepted asset pin into a new directory outside Git:

```sh
npm run ui:study -- --output /absolute/new/ui-study
python3 -m http.server 5176 --bind 127.0.0.1 --directory /absolute/new/ui-study
```

Open `http://127.0.0.1:5176`. Stop that server when review is finished. The output contains its own artwork and asset-pin provenance; it does not retain an asset-cache lease. Rebuilding requires a new output directory so earlier reviews cannot be overwritten. This command never opens the source library or changes the asset pin.

Select an approach and switch between empty, populated and full packs. Select an item to inspect it; drag its top-left corner to another cell, or press **M**, move with arrows, then **Enter** to place or **Esc** to cancel. **Organize** uses deterministic packing. Invalid placements preserve the item. Arrangement changes last only for the current page session; changing pack contents restores the comparison fixture. Equip and supply actions explain their preview-only behavior rather than altering a journey.

**Menus & HUD** contains interactive concept studies for title, pause, settings/help, HUD/loot, Forge, campfire, loading and recovery. Settings and action feedback are temporary. The illustrated Forge background provides comparison context; these studies do not demonstrate a live game renderer, production persistence, combat or first-time player acceptance.

The visual treatment uses quiet charcoal surfaces, warm ivory, aged brass, visible action names and selective ornament. Existing Clean INK artwork remains unchanged. Below 900 px, all inventory approaches use equipment/pack tabs with item details reserved below. The fixed grid scrolls instead of reducing item footprints or capacity.

## Production follow-through

The user selected **A — The workbench** after reviewing the alternatives. Game uses the centered workbench with a fixed details area and the shared quiet gothic treatment. The agreed mechanics are a fixed 192-cell pack; individual spare equipment; stacked supplies and salvage; gold outside the grid; fixed orientation; persistent drag/keyboard placement; automatic pickup placement; and explicit Organize. Full-pack operations must fail without losing rewards, equipment or salvage outputs. Incompatible prototype journeys may reset.

InventoryState owns pack entry identity, quantities, equipment assignment and coordinates, with aggregate counts derived for gameplay consumers. Version 10 checkpoints preserve positions and validate aggregate-count consistency; earlier prototype journeys reset. Save admission must validate bounds, overlap, quantities and compatible equipment. Coordinate this with GameSession commands, checkpoint versioning and browser storage tests rather than adding a second independent inventory owner in the DOM.

The shared treatment covers title/pause, Settings/Controls, HUD, Forge, campfire, loot, loading and recovery. Version 7 settings add interface scale separately from render scale and retain version 5/6 values. Existing pause/focus, cancellation and durable purchase behavior remains required. Controller support, key rebinding, new progression systems and authoring-tool redesign are outside this pass.

The selected **Ink & Brass** treatment keeps the centered workbench and uses thin brass rails with shaped corner fittings, neutral charcoal interiors, ivory serif headings and ochre primary actions. Equipment stays left of the scrolling pack; a large illustration accompanies the selected item's comparison and actions in the fixed details area. Equipment, details and pack have quiet section frames. Shared menus, campfires and upgrades use the same outer frame and illustrated lantern crest, while prompts and HUD controls use lighter brass rules. Familiar secondary actions use icons with accessible names and hover/focus tooltips. Material costs and item stats pair artwork or symbols with numbers; repeated instructions and idle status text stay off the surface. Purchase restrictions, errors and active keyboard-placement instructions remain visible. Keep the original item drawings and the fixed 12 × 16 pack; the visual mockup does not change item footprints, capacity or progression.

Review desktop, short laptop and narrow layouts, plus large interface scale and reduced motion. Use the existing Game/audio browser scenarios and the complete orchard–clearing–forge–chapel–orchard journey, including both upgrades, save/resume and death/retry. Report native, audible, human and target-hardware acceptance separately from browser results. [Verification](verification.md) owns the checks; [architecture](architecture.md#change-player-menus-or-settings) owns the runtime boundaries.
