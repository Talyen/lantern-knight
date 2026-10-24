import os from 'node:os';
import { sourceLibraryRoot } from './paths';
import { runCli } from '../cli';
import fs from 'node:fs/promises';
import path from 'node:path';
import recipes from '../../assets/audio-sources.json';
export type AudioDisposition =
  'selected' | 'alternate' | 'future-use' | 'unsuitable' | 'unclear' | 'non-audio';
const rules: readonly [RegExp, string, string, AudioDisposition][] = [
  [
    /\b(gun|guns|bullets|reload|ammunition|assaultrifle|pistol|bullet|plane|flyby|takeoff|boeing|grumman|mig|jas|jeep|rover|bmw|audi|cadillac|camaro|corvette|ferrari|ford|mazda|megane|renault|peugeot|opel|pontiac|porsche|toyota|suzuki|volkswagen|volvo|huyndai|ducati|harley|tractor|tracktor|harvester|excavator|keeway|massey|tunturi|automotive|auto|carpark|passby|onboard|rpm|carbys|machine|machines|machinery|industrial|industry|electrical|compressor|drill|dremel|sewing|server|synth|synthesizer|glitched|glitches|radio|transmission|telemetry|radar|hologram|droid|mothership|starship|planet|planets|space|future|alien|cyber|tech|beep|beeps|keyboard|printer|shredder|scanner|camera|airpods|macbook|toothbrush|ventilation|elevator|projector|cassette|cellophane|plastic|styrofoam|pvcpipe|velcro|zipper|tv|clippers|static)\b|abstractspaceship|interfacebleep|interfaceglitch|interfacebuttondigital|oldradiotuning|medicaldevices|intergalactic|narratorvoice/,
    'exclude-modern-detail',
    'Filename identifies modern technology or a synthetic science-fiction treatment; exclude from the grounded palette.',
    'unsuitable',
  ],
  [
    /\b(fart|farting|burp|puke|pee|urinal|toilet|banana|bananas|cereal|candy|capri|suns|granola|ranch|fudge|popcorn|pringles|party|balloon|balloons|toy|novelty|basketball|billiards|billliards|ping|pong|sports|golf|ski|snowboard|bicycle|swimming|funfair|amusementpark|clown|goofy)\b/,
    'exclude-tone',
    'Overt comedy, packaged food, modern sport or bathroom recording is unsuitable for current grounded fantasy cues.',
    'unsuitable',
  ],
  [
    /\b(book|books|page|pages|pageturning|paper|pergament|map|quill|lock|unlock|door|doors|gate|portcullis|drawer|chest|cork|liquid|liquids|pouring|bottles|glass|glasses|collect|itempickup|backpack|handbag|loot|salvage|buy|sell|talent|regen|restore|cast|casting|magical|firebuff|firespray|paranormal|spectral|ghosts|dungeon|cave|cavern|tomb|grave|plantgrowth)\b|firecrackling|woodenfence|largewoodenobject|hardwood|plywood|pineblock|beechplank|metalpipe|metaldestruction|glassimpact|textureglass/,
    'interaction-detail',
    'Candidate for current interactions or a future journal, locked passage, spell, dungeon or inventory action.',
    'alternate',
  ],
  [
    /\b(weapon|cleaver|dagger|knife|stab|stabs|swoosh|swooshes|woosh|whooshes|swipe|swipes|cut|flesh|gore|blood|bloody|squish|squishes|squishy|smack|slap|kick|hits|impacts|clash|counter|stun|dodge|body|oof|miss|slicer|crack|cutting|sheathe|sheath|unsheath|unsheathe|knocked|whip|throw)\b|bitecreakbloodjuicy|fencingfoil|bloodattack/,
    'combat-detail',
    'Candidate for body motion, material contact, injury or future weapon mechanics; keep gore restrained.',
    'alternate',
  ],
  [
    /\b(rope|chain|chains|debris|brick|plank|woodpile|woodpanel|rocks|scrape|scraping|scratching|shovel|chisel|rustles|strap|creak|creaks|creaking|squeaks|crackle|crackles|grit|land|dirt|grass|hardwood|foley|rustle|rustling|sheets|blanket|clothes|jacket|fabric|silk|leatherglove)\b/,
    'foley-detail',
    'Material foley candidate for movement, inventory, breakables or future environmental interactions.',
    'alternate',
  ],
  [
    /\b(breeze|bush|bushes|branch|fronds|foliage|reeds|creek|streams|quietstream|ravens|crows|robins|nighthawk|geese|goose|rainloopheavy|rainlooplight|thunder|thunderstorm|whirlwind|waterfall|fountain|splash|splashes|lake|waves|wave|seawash|coastal|coast|shore|swamp|jungle|desert|lagoon|pond|geyser|mudpot|lava|bubbles|bubbling|steam|hurricane)\b/,
    'environment-detail',
    'Natural atmosphere or material candidate; defer incompatible biome, coastal, lava and severe-weather recordings.',
    'future-use',
  ],
  [
    /\b(voice|voices|vocal|vocalizations|vox|laugh|laughter|laughing|giggly|giggling|cackling|child|kids|human|female|male|speaking|speakingintongues|muezzin|prayer|prayers|protests|chant|service|churches|temple|audience|applause|cheers|bazar|bazaar|market|restaurant|restaurants|cafe|coffeeshop|city|street|town|village|countryside|dining)\b|emote|citystreets|busystreet|carbys/,
    'defer-inhabited',
    'Reserve for an explicitly inhabited location or character; speech and modern backgrounds require listening review.',
    'future-use',
  ],
  [
    /\b(deer|pig|fish|dragon|goat|gooses|goose|meow|pony|hawk|goshawk|eagle|squirrel|coyotes|dogs|horses|cormorants|stags|macaw|cow|chicken|hen|animals|bark|barks|barking|growling|hisses|sipping|gulp|drinking|swallowing|cough|breathe|mouth|mouthy|mouthnoises)\b|creaturevoice|growlmonster|zombievocalizations|animaldigging/,
    'defer-species',
    'Species-specific animal, creature or bodily recording; reserve for matching actors and avoid voiced skeletons.',
    'future-use',
  ],
  [
    /\b(chips|poker|backgammon|domino|board|boardgame|archery|crossbow|harpoon|cooking|kitchen|frying|cutlery|cuttlery|silverware|teapot|tea|wine|mug|cup|plate|plates|ceramic|sack|barley|flour|sugar|nails|scissors|wire|brush|steel|tin|copperpipe|rumbling|rumble|bass|tension|atmospheric|atmosphere|soundscape|ambience|ambiences|ambient|ambiance|soundscapes|musical|guitar|cymbal|cymbals|drumset|marimba|kalimba|xylophone|maracas|whistle|string|strings|handdrum|brass|bowed|harmonic)\b/,
    'future-material-or-atmosphere',
    'Reserve for future props, mechanics, music or an authored atmospheric layer; no current runtime binding.',
    'future-use',
  ],
  [
    /\b(ui|interface|alert|alerts|error|hover|hovers|scroll|select|selection|decline|fail|complete|check|ding|counter|pop|plops|transition|transitions|mechanical|health|gameover|gamefinish|powerup)\b/,
    'interface-detail',
    'Interface or outcome accent candidate; audition for a restrained non-electronic treatment.',
    'alternate',
  ],

  [
    /\b(car|cars|truck|motorcycle|aircraft|airplane|helicopter|jet|rocket|spaceship|spacecraft|robot|robotic|cyborg|computer|telephone|cellphone|smartphone|electronic|digital|sci fi|scifi|futuristic|laser|blaster|machinegun|gunshot|rifle|pistol|shotgun|cannon|tank|engine|motor|traffic|subway|train|railway|ambulance|police|siren|toaster|refrigerator|microwave|vacuum|electric|synthesized|glitch|cartoon|toon|comical)\b/,
    'exclude-modern',
    'Modern machinery, technology, weapons, or overt comic treatment conflicts with grounded fantasy.',
    'unsuitable',
  ],
  [
    /\b(speech|talking|conversation|chatter|narrator|words|dialogue|crying|baby|children|crowd|people)\b/,
    'defer-voices',
    'Voices or crowds need a specific inhabited scene and listening review; current scenes do not call for them.',
    'future-use',
  ],
  [
    /\b(footstep|footsteps|walk|walking|run|running|landing|jump|cloth|clothing|leather|armor|armour|gear)\b/,
    'movement',
    'Candidate for surface-specific locomotion, dodge, equipment or body foley.',
    'alternate',
  ],
  [
    /\b(sword|blade|swing|swish|whoosh|hit|impact|punch|slash|slice|bone|bones|cracking|melee|strike|shield|parry|block|attack)\b/,
    'combat',
    'Candidate for attack motion, confirmed contact, skeletal damage or future weapon actions.',
    'alternate',
  ],
  [
    /\b(fire|flame|fireball|torch|campfire|burn|burning|magic|spell|arcane|sorcery|ethereal|heal|buff|purge|energy)\b/,
    'lantern',
    'Candidate for lantern flare, healing, campfire or future supernatural effects.',
    'alternate',
  ],
  [
    /\b(coin|coins|gold|pouch|bag|bottle|potion|chest|crate|container|break|breaking|snap|crunch|rattle|wood|wooden|metal|stone|rock|glass)\b/,
    'interaction',
    'Candidate for loot, inventory, containers, breakables, or material-specific foley.',
    'alternate',
  ],
  [
    /\b(forest|wind|bird|birds|birdsong|crow|raven|owl|cricket|crickets|leaves|leaf|tree|trees|rain|water|river|stream|insect|insects|nature|woodland|woods)\b/,
    'environment',
    'Candidate for outdoor ambience or localized natural sound; match habitat and weather before use.',
    'alternate',
  ],
  [
    /\b(confirm|cancel|denied|deny|button|click|switch|toggle|equip|unequip|notification|menu|pause|unpause|success|victory|defeat|chime|bell|positive|negative)\b/,
    'interface',
    'Candidate for restrained interface or accepted outcome feedback; audition for tonal fit.',
    'alternate',
  ],
  [
    /\b(monster|creature|zombie|ghost|growl|roar|hiss|scream|breath|breathing|grunt|pain|death|animal|dog|cat|horse|bear|wolf|snake|frog)\b/,
    'creature',
    'Reserve for species-specific creature sound; avoid assigning voiced monsters to skeletal enemies without audition.',
    'future-use',
  ],
  [
    /\b(music|battle|piano|harpsichord|flute|harp|zither|drum|percussion|stinger|drone|instrument|violin|cello|singing|choir|musical)\b/,
    'music',
    'Music and musical atmosphere candidate; music playback is deferred.',
    'future-use',
  ],
  [
    /\b(craft|crafting|forge|smith|anvil|hammer|mine|mining|saw|tool|card|cards|dice|bow|arrow|ice|snow|freeze|lightning|ocean|sea|beach|underwater)\b/,
    'future-mechanic',
    'Reserve for future mechanics, materials or locations absent from the current game.',
    'future-use',
  ],
];
export function reviewFilename(relative: string): {
  disposition: AudioDisposition;
  use: string;
  reason: string;
} {
  if (!/\.(wav|ogg|mp3|flac)$/i.test(relative))
    return { disposition: 'non-audio', use: 'metadata', reason: 'Not a playable audio source.' };
  const selected = recipes.entries.filter((r) => r.source === relative);
  if (selected.length)
    return {
      disposition: 'selected',
      use: [...new Set(selected.map((entry) => entry.cue))].join(', '),
      reason:
        'Explicit hashed source recipe; filename fit selected. Audible approval remains separate.',
    };
  const stem = path
    .basename(relative)
    .split('__')[0]!
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ');
  if (/\/Music\//i.test(relative))
    return {
      disposition: 'future-use',
      use: 'music',
      reason: 'Named music track; music playback deferred.',
    };
  for (const [pattern, use, reason, disposition] of rules)
    if (pattern.test(stem))
      return {
        disposition,
        use,
        reason: reason + ' Filename match: ' + pattern.exec(stem)![0].trim() + '.',
      };
  return {
    disposition: 'unclear',
    use: 'unassigned',
    reason:
      'Filename does not identify a reliable current-game use; audition required before selection.',
  };
}
export async function reviewLibrary(root: string, destination: string) {
  const records: { source: string; disposition: AudioDisposition; use: string; reason: string }[] =
    [];
  async function visit(directory: string) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else {
        const source = path.relative(root, file).split(path.sep).join('/');
        records.push({
          source,
          ...(entry.isFile()
            ? reviewFilename(source)
            : {
                disposition: 'non-audio' as const,
                use: 'unsupported',
                reason: 'Not a regular source file; not followed.',
              }),
        });
      }
    }
  }
  await visit(root);
  const counts: Record<string, number> = {};
  for (const record of records) counts[record.disposition] = (counts[record.disposition] ?? 0) + 1;
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, 'filename-review.json'),
    JSON.stringify(
      { root, method: 'Exhaustive filename rule review; no auditory claims.', counts, records },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(destination, 'filename-review.tsv'),
    'source\tdisposition\tsuggested use\treason\n' +
      records.map((r) => [r.source, r.disposition, r.use, r.reason].join('\t')).join('\n') +
      '\n',
  );
  console.log(JSON.stringify({ files: records.length, counts, destination }));
}
runCli(import.meta.url, async () => {
  await reviewLibrary(
    path.join(sourceLibraryRoot(), 'Sounds'),
    process.argv[2] ?? path.join(os.homedir(), 'Library/Caches/LanternKnight/audio-review'),
  );
});
