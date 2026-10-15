# Scene design guidance

Use the project Clean INK art direction, preserving original sources and canonical references. Prefer flat stages, whole illustrated shells and registered native ground panels. Hidden collision/rendering carriers and shadow proxies support the artwork.

These are prototype design recommendations. Palette membership, composition zones, density, scale, tint, mirroring, grounding and treatment can be experimented with. The editor shows advice rather than rejecting otherwise valid layouts. Source fidelity remains protected. Missing assets/clips, malformed numbers, duplicate IDs, cyclic attachments, obstructed required entries and unsupported light capacity remain errors.

## Native ground panels

Measure native dimensions and density. Prefer quiet beds and coordinated intact path/floor/threshold panels with authored joins. Do not enlarge rasters and call the enlarged results native. Inspect joins, repeated landmarks, contrast and combat visibility in the actual renderer when investigating visuals.

Choose each complete painting's world width with the hero visible beside human-scale landmarks: doorways, benches, tables, stair treads and passages. Image resolution alone does not determine world size. Inspect gameplay captures before accepting the scale, then validate actor clearance and navigation at that size. Later floor resizing reprojects accepted interaction geometry and test destinations with the artwork in one undoable edit; repeat the clearance and visual checks after resizing.

## Scene cohesion

Match the fixed sun direction and elevation to the shadows painted into the scene. The shared lighting rig owns directional casting; grounded props and actors also receive tighter independent contact shadows. Painted occlusion masks keep ground shadows off illustrated upright scenery. Interior bounds disable outdoor sun casting while retaining contact shadows and local illumination.

Use Atmosphere → Painted shade zones for canopy or architectural shade depicted in a floor painting. Each zone has world X/Z, a radius and a shade amount from 0 to 0.75. Its edge fades smoothly, and overlapping zones use the strongest shade. Actors and props respond at their foot registration; the painting keeps its existing shade, while flames and local lights remain luminous. View → Zones shows the circles; geometry mode moves their centers. Painting resizes reproject zone centers and scale their radii with the painting width. Review zones after replacing ground artwork.

Production scenes use **Lantern night** (ambient 0.28, minimum light 0.06, key strength 0.06): dim cool ambient light and a weak directional key leave the hero’s steady warm lantern as the main nearby light source. Its broad pool follows the drawn lantern socket and illuminates the ground, placed props and actors together; ability effects add their own light without changing the lamp’s intensity. Golden hour and Silver hour remain selectable for comparisons. Production defaults preserve painted contrast with restrained finishing and no depth-of-field blur. Keep stronger bloom, atmosphere and defocus as deliberate experiments. Compare identical camera positions and poses with lighting, casting and finishing toggled before accepting a treatment; inspect heroes, enemies, props and transparent edges at gameplay scale.

## Verification

Use the shared development server and affected scene/editor browser scenario. Stable fixtures protect engine and registration behavior without freezing production counts/routes. Original art preparation and explicit sharing follow [assets](assets.md); [verification](verification.md) owns evidence boundaries.

## Authored painting scales

Saved painting drafts and immutable interaction profiles provide starting maps for level design, with skeleton placements and repeatable movement destinations. Profiles preserve authored data; they do not certify complete collision or occlusion. An empty interaction-region list is valid and supplies no painted-prop collision or occlusion. Inspect the regions and run [movement validation](developer-tools.md#movement-validation) before relying on a draft's authored boundaries.

The widths below record the starting scales. The current scene document under [authoring/scenes](../authoring/scenes/README.md) owns its editable floor dimensions, placements and interaction data. World widths keep the existing hero size; the factor compares the floor with a 40-unit-wide baseline, rather than scaling the actor. Change width and depth together to preserve the painting aspect ratio. These starting scales impose no validation limits on later edits.

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

Upright props and enemy spawns need fully visible placement space. Scene resolution checks base clearance; prepared-asset validation also reserves the entire registered drawing plus a 0.12-unit gap against painted collision footprints and occlusion masks. The editor ghost, accepted edits, saves, Game and playtests use this rule. Scale, mirroring, rotation, elevation and the whole spawn jitter interval contribute to the envelope. Enemy idle and locomotion drawings cover all delivered facings; containers reserve their closed and opened states. A mask hole is usable only when the complete envelope fits inside it. Native alpha measurements in `src/content/placement-registration.ts` are bound to exact manifest hashes and verified against supplied pixels; unmeasured or changed artwork reserves its full registered trim until reviewed. This conservative check does not certify unmasked artwork or replace rendered review.

Place ground overlays as ground artwork and mounted objects as attachments. Interactive containers still require visible clearance when tagged as ground artwork. Canopy masks do not become movement blockers: characters can pass behind scenery during play, but authored enemies and loot begin in visible areas. Movement diagnostics add up to three fully visible, reachable enemies where space permits.

Every placed object needs a reason tied to the painting. Keep stored goods, fires and bedding off paths; paths admit relevant transport or boundary remnants. Use a few related objects around an existing landmark, preserve fighting space, and prefer fewer placements over hiding objects behind scenery or filling a count. The [Orchard composition brief](../authoring/scenes/README.md#orchard-composition) records the opening's work areas.
