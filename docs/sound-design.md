# Sound design

Grounded dark fantasy: natural foley, restrained lantern magic, quiet woodland atmosphere and sparse interface accents. Essential feedback remains visual when audio is unavailable or muted. Music playback is deferred.

## Palette and cues

| Game behavior | Prepared cue families | Source direction |
| --- | --- | --- |
| Actual walking | step-grass, step-dirt, step-stone, step-wood, cloth | Four variants per surface; quiet clothing rustle. Orchard uses grass, clearing uses dirt; developer interiors default to stone. |
| Sweep/lunge and enemy attacks | sword, dodge | Three supplied sword attacks at the fixed action-contact tick, including misses; dry cloth motion for the unarmed thrall. |
| Confirmed hits, stagger, death | impact, hurt, bone, death | Three sword contacts, hero body-hit grunts, two bone cracks; restrained harpsichord defeat accent for the hero. |
| Dodge and equipment | dodge, armor, equip, unequip | Cloth/leather movement and sheath foley; inventory cues only after a real accepted change. |
| Lantern flare and potion | flare, potion, heal | Three fireball accents, three small liquid movements, subtle healing accent. |
| Loot and world interactions | coin, pickup, container, break | Two coin textures, bag clasp, two chest openings and two wood fractures. |
| Campfire/rest and travel | fire, campfire, heal, travel | Lighting accent, localized torch loop, healing on accepted rest and quiet eerie passage on completed transition. |
| Menus and outcomes | ui-confirm, ui-cancel, ui-deny, success, salvage | Low interface accents, throttled denial, restrained completion accent; autosaves stay quiet. |
| Environmental atmosphere | — | Outdoor ambience is quiet after the forest and wind originals were removed; localized campfire audio remains. |

The recipes select 58 samples from 57 distinct source paths across 29 cue families. Source identifiers and exact choices live in `assets/audio-sources.json`. Filename matches are provisional candidates. The exhaustive external review retains every numeric variant and explains alternates, future uses, exclusions and uncertain filenames; modern machines, science-fiction effects and overt comic recordings are excluded from the current palette. Additional weapons, creatures, journals, crafting, weather and music remain future candidates rather than unused runtime payload.

## Listening and tuning

Deferred until the user has time; this listening pass does not block the next development task.

Game pause and Dev Preview inspection panels expose independent master/effects/ambience levels and mute. Preview additionally offers every prepared sample with Play/Stop controls. Listen through the selected samples, then exercise movement, combat, loot, inventory, rest, travel and menus in context. Check voices/background contamination, tails, repetition, overlapping impacts, relative levels and wrap seams. Automated decoding, peak measurements and lifetime tests do not certify this audible mix; listening approval remains pending until performed and recorded.

Sound recipes preserve original sources. [Audio preparation](assets.md#audio-preparation) owns source verification, derivatives, immutable delivery and task-scoped publication. [Audio architecture](architecture.md#audio) owns playback lifetimes, failure isolation and resource limits.
