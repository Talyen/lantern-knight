import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sceneFixture } from '../fixtures/scene';
import {
  checkPair,
  completeCapture,
  prepareRound,
  readRound,
  recordPreference,
  sha256,
  writeJSON,
  type ComparisonSpec,
} from '../../tools/scene-placement/session';

const spec: ComparisonSpec = {
  baseline: 'baseline.json',
  candidate: 'candidate.json',
  baselineSkill: 'skill.md',
  candidateSkill: 'skill.md',
  phase: 'practice',
  brief: 'Keep the route open and the tomb readable',
  hypothesis: 'A grouped offering reads more clearly than scattered objects',
  requirements: { objects: ['family-tomb-west'], enemies: ['guard'], minProps: 2, minEnemies: 1 },
  view: { center: { x: 0, z: 0 }, hero: { x: 0, z: 0 }, verticalSpan: 10 },
};
function scenes() {
  const baseline = sceneFixture('graveyard');
  baseline.gameplay!.spawns.push({ id: 'guard', actor: 'skeleton', x: 0, z: 1 });
  const candidate = structuredClone(baseline);
  candidate.objects[0]!.x! += 1;
  candidate.gameplay!.spawns[0]!.x += 1;
  return { baseline, candidate };
}

test('placement comparisons retain gameplay and reject empty or confounded alternatives', () => {
  const { baseline, candidate } = scenes();
  checkPair(baseline, candidate, spec);
  const changed = structuredClone(candidate);
  changed.look.rig = 'lantern';
  assert.throws(() => checkPair(baseline, changed, spec), /Only objects/);
  const empty = structuredClone(candidate);
  empty.objects = [];
  assert.throws(() => checkPair(baseline, empty, spec), /required props/);
  const rewards = structuredClone(candidate);
  rewards.gameplay!.spawns[0]!.rewards = [{ item: 'gold', amount: 99 }];
  assert.throws(() => checkPair(baseline, rewards, spec), /combat rules/);
  assert.throws(() => checkPair(baseline, baseline, spec), /no placement change/);
});

test('human choices stay bound to blinded snapshots and cannot overwrite decisions or changed captures', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-placement-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { baseline, candidate } = scenes();
  await Promise.all([
    writeJSON(path.join(root, 'baseline.json'), baseline),
    writeJSON(path.join(root, 'candidate.json'), candidate),
    writeJSON(path.join(root, 'spec.json'), spec),
    fs.writeFile(path.join(root, 'skill.md'), 'Frozen instructions'),
    fs.writeFile(path.join(root, 'assets.json'), '{}'),
  ]);
  const directory = path.join(root, 'round');
  const round = await prepareRound(directory, path.join(root, 'spec.json'), {
    checkout: root,
    commit: 'fixture',
    assetsFile: path.join(root, 'assets.json'),
  });
  const { hash } = await readRound(directory);
  assert.deepEqual(new Set(round.labels), new Set(['baseline', 'candidate']));
  await assert.rejects(recordPreference(directory, 'A'), /ENOENT/);
  const a = Buffer.from('first image'),
    b = Buffer.from('second image');
  await Promise.all([
    fs.writeFile(path.join(directory, 'A.png'), a),
    fs.writeFile(path.join(directory, 'B.png'), b),
    writeJSON(path.join(directory, 'capture-pending.json'), {
      round: hash,
      renderer: 'fixture',
      assets: 'pinned-fixture',
      gpu: 'software',
      images: [sha256(a), sha256(b)],
      framing: [{}, {}],
    }),
  ]);
  await assert.rejects(recordPreference(directory, 'A'), /ENOENT/);
  await completeCapture(directory);
  await fs.writeFile(path.join(directory, 'B.png'), 'replacement');
  await assert.rejects(recordPreference(directory, 'A'), /Screenshots changed/);
  await fs.writeFile(path.join(directory, 'B.png'), b);
  const vote = await recordPreference(directory, 'B');
  assert.equal(vote.winner, round.labels[1]);
  assert.equal(vote.source, 'human');
  await assert.rejects(recordPreference(directory, 'A'), /EEXIST/);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'preference.json'), 'utf8')).choice,
    'B',
  );
  await fs.writeFile(path.join(directory, 'candidate.json'), '{}');
  await assert.rejects(readRound(directory), /inputs changed/);
});
