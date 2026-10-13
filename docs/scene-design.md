# Scene design guidance

Use the project Clean INK art direction, preserving original sources and canonical references. Prefer flat stages, whole illustrated shells and registered native ground panels. Hidden collision/rendering carriers and shadow proxies support the artwork.

These are prototype design recommendations. Palette membership, composition zones, density, scale, tint, mirroring, grounding and treatment can be experimented with. The editor shows advice rather than rejecting otherwise valid layouts. Source fidelity remains protected. Missing assets/clips, malformed numbers, duplicate IDs, cyclic attachments, obstructed required entries and unsupported light capacity remain errors.

## Native ground panels

Measure native dimensions and density. Prefer quiet beds and coordinated intact path/floor/threshold panels with authored joins. Do not enlarge rasters and call the enlarged results native. Inspect joins, repeated landmarks, contrast and combat visibility in the actual renderer when investigating visuals.

Choose each complete painting's world width with the hero visible beside human-scale landmarks: doorways, benches, tables, stair treads and passages. Image resolution alone does not determine world size. Inspect gameplay captures before accepting the scale, then validate actor clearance and navigation at that size. Later floor resizing reprojects accepted interaction geometry and test destinations with the artwork in one undoable edit; repeat the clearance and visual checks after resizing.

## Verification

Use the shared development server and affected scene/editor browser scenario. Stable fixtures protect engine and registration behavior without freezing production counts/routes. Original art preparation and explicit sharing follow [assets](assets.md); [verification](verification.md) owns evidence boundaries.

## Authored painting scales

The saved painting drafts below have immutable interaction profiles, three skeletons and repeatable movement destinations. These are starting maps for level design. World widths below keep the existing hero size; the factor compares the floor with a 40-unit-wide baseline, rather than scaling the actor. Width and depth change together to preserve the painting aspect ratio. Saved scene documents own the current dimensions; these starting scales impose no validation limits on later edits.

| Scene                     | World width | Floor scale vs 40 |
| ------------------------- | ----------: | ----------------: |
| Abandoned Orchard         |          32 |             0.80× |
| Cloister                  |          40 |             1.00× |
| Crypt                     |          48 |             1.20× |
| Desecrated Chapel         |          32 |             0.80× |
| Dry Quarry                |          40 |             1.00× |
| Forest Gathering Clearing |          28 |             0.70× |
| Forest Gathering          |          36 |             0.90× |
| Graveyard Layout          |          32 |             0.80× |
| Graveyard Open Ground     |          28 |             0.70× |
| Graveyard Terraces        |          36 |             0.90× |
| Graveyard                 |          30 |             0.75× |
| Highland Watchpost        |          48 |             1.20× |
| Initiation Chamber Round  |          28 |             0.70× |
| Initiation Chamber        |          36 |             0.90× |
| Keeper’s Glade Camp       |          32 |             0.80× |
| Keeper’s Glade Home       |          28 |             0.70× |
| Keeper’s Glade            |          36 |             0.90× |
| Last Watchtower           |          24 |             0.60× |
| Observatory Courtyard     |          40 |             1.00× |
| Observatory Chart Library |          28 |             0.70× |
| Observatory Platforms     |          24 |             0.60× |
| Observatory Rooms         |          40 |             1.00× |
| Observatory               |          40 |             1.00× |
| Raven Abbey               |          20 |             0.50× |
| Rootwood Clearing         |          28 |             0.70× |
| Rootwood                  |          28 |             0.70× |
| Ruined Craftsman Forge    |          20 |             0.50× |
| Ruined Village Paths      |          28 |             0.70× |
| Ruined Village            |          32 |             0.80× |
| woodland                  |          40 |             1.00× |

The prototype uses one walking elevation per painting. Raised galleries, altar platforms, stairs and bridge undersides are blocked where they conflict with the selected connected floor. Observatory Platforms uses its middle road; Chart Library uses its central instrument court; Observatory uses the middle floor around the raised island; Observatory Rooms uses the western rooms and southern hall. These choices need revisiting if multiple walking elevations are introduced.
