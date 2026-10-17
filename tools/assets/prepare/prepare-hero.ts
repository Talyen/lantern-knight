import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { hash } from '../../compiler';
import { parseSource, type Source } from '../../../src/assets/schema';
import { source as definition } from '../definition';
import { heroTimings } from '../../../src/content/hero-actions';
import scaleRecipe from '../../../authoring/hero-scale.json';
import cursorRecipe from '../../../authoring/hero-cursor.json';
import { heroFrameScales, scaleHeroRegistration } from '../hero-scale';
import type { PreparationContext } from '../context';
import { preparationOutput } from '../preparation-output';
export async function prepare(context: PreparationContext, check = false) {
  const { write, pack } = preparationOutput(context, check);
  const { readLibrarySource } = context;

  type Registration = { canvas: [number, number]; anchor: [number, number]; density: number };
  type Record = {
    id: string;
    group: string;
    member: string;
    sha256: string;
    registration: Registration;
  };

  const { stdout } = await promisify(execFile)('python3', ['-B', 'tools/assets/hero.py'], {
    maxBuffer: 4 * 1024 * 1024,
  });
  const handoff = JSON.parse(stdout) as {
    frames: Record[];
    clips: {
      id: string;
      heading: string;
      frames: string[];
      durationsMs: number[];
      loop: boolean;
      notifies: [];
    }[];
    timings: unknown;
    limitations: string[];
    handoffSha256: string;
  };
  const introduced = handoff.frames.filter(
    (frame) => frame.id.startsWith('travel_') || /^idle-d(45|135|225|315)-/.test(frame.id),
  );
  if (
    introduced.length !== Object.keys(cursorRecipe.frames).length ||
    introduced.some((frame) => !Object.hasOwn(cursorRecipe.frames, frame.id))
  )
    throw new Error('Hero cursor attachment review must cover exactly the new drawings');
  const moving = handoff.clips.filter((clip) => clip.id.startsWith('travel_'));
  if (moving.length !== Object.keys(cursorRecipe.contacts).length)
    throw new Error('Hero cursor contact review must cover exactly the locomotion pairs');
  for (const clip of moving) {
    const contacts =
      cursorRecipe.contacts[`${clip.id}:${clip.heading}` as keyof typeof cursorRecipe.contacts];
    if (
      !contacts?.length ||
      new Set(contacts).size !== contacts.length ||
      contacts.some(
        (drawing) => !Number.isInteger(drawing) || drawing < 0 || drawing >= clip.frames.length,
      )
    )
      throw new Error(`Invalid hero cursor contacts: ${clip.id}/${clip.heading}`);
  }
  const scales = heroFrameScales(scaleRecipe, handoff.clips);
  const base = definition(
    'ink-hero-current',
    'character',
    [632, 688],
    [301, 556],
    350,
    'four-directional',
  );
  const asset: Source['asset'] = {
    ...base.asset,
    id: 'ink-hero-current',
    // Original drawings and their reviewed fallback sockets retain native frame IDs.
    contentVersion: 'hero-cursor-20261017-v01',
    viewMode: 'mixed-directional',
    canvas: [632, 688],
    anchor: [301, 556],
    density: 350,
    atlasSize: 2048,
    limitations: [
      'TEST selection; approximate registration and action joins require gameplay review.',
      ...handoff.limitations,
    ],
    provenance: {
      ...base.asset.provenance,
      source: 'hero-handoff + cursor locomotion / ' + handoff.handoffSha256,
    },
    recipe: 'prepare-hero-cursor-v1 / scale-reviewed supplied drawings',
    requiredClips: [],
    clips: {},
  };
  const source: Source = { schemaVersion: 2, asset, frames: [] };
  for (const record of handoff.frames) {
    const data = await readLibrarySource(record.member, record.group);
    if (hash(data) !== record.sha256) throw new Error('Hero source changed: ' + record.id);
    const file = `ink/ink-hero-current/${record.id}.png`;
    await write('staging/' + file, data);
    const lantern = cursorRecipe.frames[record.id as keyof typeof cursorRecipe.frames]?.lantern;
    source.frames.push({
      id: record.id,
      path: file,
      origin: 'imported-study',
      attachments: lantern ? { lantern: [lantern[0]!, lantern[1]!] } : {},
      registration: scaleHeroRegistration(record.registration, scales.get(record.id)!),
    });
  }
  for (const clip of handoff.clips) {
    const { id, heading, ...timing } = clip;
    const directed = heroTimings[id]?.[heading as keyof (typeof heroTimings)[string]];
    const supplied = id.startsWith('travel_') || (id === 'idle' && !directed);
    if (!supplied && (!directed || directed.holdsMs.length !== timing.frames.length))
      throw new Error('Directed hero recipe differs from drawing count: ' + id + '/' + heading);
    (asset.clips[id] ??= {})[heading as keyof (typeof asset.clips)[string]] = {
      ...timing,
      durationsMs: supplied ? timing.durationsMs : directed!.holdsMs,
      notifies: id.startsWith('travel_')
        ? cursorRecipe.contacts[`${id}:${heading}` as keyof typeof cursorRecipe.contacts].map(
            (drawing, i) => ({
              id: `foot-${i}`,
              kind: 'footstep' as const,
              atMs: timing.durationsMs.slice(0, drawing).reduce((sum, hold) => sum + hold, 0),
            }),
          )
        : timing.notifies,
    };
  }
  asset.requiredClips = Object.keys(asset.clips);
  parseSource(source);
  await write(
    'staging/ink/hero-receipt.json',
    JSON.stringify(
      {
        handoffSha256: handoff.handoffSha256,
        frames: handoff.frames,
        originalTimings: handoff.timings,
        scale: scaleRecipe,
      },
      null,
      2,
    ) + '\n',
  );
  const manifest = await pack(source);
  console.log(
    `${check ? 'Verified' : 'Prepared'} current hero: ${source.frames.length} supplied frames / ${manifest.pages.length} pages.`,
  );
}
