import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';

const point = z.strictObject({ x: z.number().finite(), z: z.number().finite() });
const comparisonSpec = z.strictObject({
  baseline: z.string().min(1),
  candidate: z.string().min(1),
  baselineSkill: z.string().min(1),
  candidateSkill: z.string().min(1),
  phase: z.enum(['practice', 'holdout']),
  brief: z.string().min(1),
  hypothesis: z.string().min(1),
  requirements: z.strictObject({
    objects: z.array(z.string()),
    enemies: z.array(z.string()),
    minProps: z.number().int().nonnegative(),
    minEnemies: z.number().int().nonnegative(),
  }),
  view: z.strictObject({
    center: point,
    hero: point,
    verticalSpan: z.number().finite().positive(),
  }),
});
export type ComparisonSpec = z.infer<typeof comparisonSpec>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const variant = z.strictObject({ scene: digest, skill: digest });
const roundSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().uuid(),
  createdAt: z.string(),
  checkout: z.string(),
  commit: z.string(),
  spec: comparisonSpec,
  assets: digest,
  variants: z.strictObject({ baseline: variant, candidate: variant }),
  labels: z.enum(['baseline', 'candidate']).array().length(2),
});
type Round = z.infer<typeof roundSchema>;
const captureSchema = z.strictObject({
  round: digest,
  renderer: z.string().min(1),
  assets: z.string().min(1),
  gpu: z.enum(['hardware', 'software']),
  images: z.tuple([digest, digest]),
  framing: z.array(z.unknown()).length(2),
});

export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const readJSON = async (file: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJSON = (file: string, value: unknown) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

// Experiments own placements, not the painting, lighting, rewards, or progression.
export function checkPair(a: SceneDocument, b: SceneDocument, spec: ComparisonSpec) {
  const fixed = (scene: SceneDocument) => {
    const { objects: _objects, gameplay, ...rest } = scene;
    if (!gameplay) throw new Error('Comparisons require explicit authored gameplay');
    const { spawns: _spawns, ...rules } = gameplay;
    return { ...rest, gameplay: rules };
  };
  if (!isDeepStrictEqual(fixed(a), fixed(b)))
    throw new Error(
      'Only objects and enemy spawns may differ; keep the scene and gameplay rules fixed',
    );
  if (isDeepStrictEqual(a.objects, b.objects) && isDeepStrictEqual(a.gameplay, b.gameplay))
    throw new Error('Comparison has no placement change');
  for (const scene of [a, b]) {
    const objects = new Set(scene.objects.map((object) => object.id));
    const enemies = new Set(scene.gameplay!.spawns.map((enemy) => enemy.id));
    if (
      spec.requirements.objects.some((id) => !objects.has(id)) ||
      spec.requirements.enemies.some((id) => !enemies.has(id)) ||
      scene.objects.filter((object) => object.kind === 'prop').length <
        spec.requirements.minProps ||
      enemies.size < spec.requirements.minEnemies
    )
      throw new Error('Both alternatives must retain the brief’s required props and enemies');
  }
  // Preserve combat tuning and reward identities while permitting spawn relocation.
  const enemies = (scene: SceneDocument) =>
    scene
      .gameplay!.spawns.map(({ x: _x, z: _z, jitterZ: _jitter, ...enemy }) => enemy)
      .sort((x, y) => x.id.localeCompare(y.id));
  if (!isDeepStrictEqual(enemies(a), enemies(b)))
    throw new Error(
      'Enemy comparisons relocate existing enemies without changing their combat rules',
    );
}

export async function prepareRound(
  directory: string,
  specFile: string,
  provenance: { checkout: string; commit: string; assetsFile: string },
) {
  const spec = comparisonSpec.parse(await readJSON(specFile));
  const source = path.dirname(path.resolve(specFile));
  const load = (file: string) => fs.readFile(path.resolve(source, file));
  const [baseline, candidate, baselineSkill, candidateSkill, assets] = await Promise.all([
    load(spec.baseline),
    load(spec.candidate),
    load(spec.baselineSkill),
    load(spec.candidateSkill),
    fs.readFile(provenance.assetsFile),
  ]);
  checkPair(
    parseSceneDocument(JSON.parse(baseline.toString())),
    parseSceneDocument(JSON.parse(candidate.toString())),
    spec,
  );
  const round: Round = {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    checkout: provenance.checkout,
    commit: provenance.commit,
    spec,
    assets: sha256(assets),
    variants: {
      baseline: { scene: sha256(baseline), skill: sha256(baselineSkill) },
      candidate: { scene: sha256(candidate), skill: sha256(candidateSkill) },
    },
    labels: randomInt(2) ? ['baseline', 'candidate'] : ['candidate', 'baseline'],
  };
  await fs.mkdir(directory); // Never overwrite another comparison or its human decision.
  await Promise.all([
    ...Object.entries({
      baseline,
      candidate,
      'baseline-skill': baselineSkill,
      'candidate-skill': candidateSkill,
      assets,
    }).map(([name, bytes]) =>
      fs.writeFile(path.join(directory, name + (name.endsWith('skill') ? '.md' : '.json')), bytes, {
        flag: 'wx',
      }),
    ),
    writeJSON(path.join(directory, 'round.json'), round),
  ]);
  return round;
}

export async function readRound(directory: string) {
  const bytes = await fs.readFile(path.join(directory, 'round.json'));
  const round = roundSchema.parse(JSON.parse(bytes.toString()));
  if (new Set(round.labels).size !== 2) throw new Error('Invalid blinded label mapping');
  for (const name of ['baseline', 'candidate'] as const) {
    const scene = await fs.readFile(path.join(directory, name + '.json'));
    const skill = await fs.readFile(path.join(directory, name + '-skill.md'));
    if (
      sha256(scene) !== round.variants[name].scene ||
      sha256(skill) !== round.variants[name].skill
    )
      throw new Error('Comparison inputs changed; prepare a new round');
  }
  if (sha256(await fs.readFile(path.join(directory, 'assets.json'))) !== round.assets)
    throw new Error('Comparison asset identity changed');
  return { round, hash: sha256(bytes) };
}

async function readCapture(directory: string, filename: string) {
  const { round, hash } = await readRound(directory);
  const bytes = await fs.readFile(path.join(directory, filename));
  const capture = captureSchema.parse(JSON.parse(bytes.toString()));
  if (capture.round !== hash) throw new Error('Capture belongs to a different round');
  for (const [i, label] of ['A', 'B'].entries())
    if (sha256(await fs.readFile(path.join(directory, label + '.png'))) !== capture.images[i])
      throw new Error('Screenshots changed after capture; do not record a preference');
  return { round, hash, bytes };
}

// Publish only after the browser runner, including fixture teardown, succeeds.
export async function completeCapture(directory: string) {
  const { bytes } = await readCapture(directory, 'capture-pending.json');
  await fs.writeFile(path.join(directory, 'capture.json'), bytes, { flag: 'wx' });
}

export async function recordPreference(
  directory: string,
  choice: 'A' | 'B' | 'neither',
  feedback?: string,
) {
  const { round, hash, bytes } = await readCapture(directory, 'capture.json');
  const decision = {
    round: hash,
    capture: sha256(bytes),
    choice,
    winner: choice === 'neither' ? null : round.labels[choice === 'A' ? 0 : 1]!,
    ...(feedback ? { feedback } : {}),
    source: 'human',
    at: new Date().toISOString(),
  };
  await writeJSON(path.join(directory, 'preference.json'), decision);
  return decision;
}
