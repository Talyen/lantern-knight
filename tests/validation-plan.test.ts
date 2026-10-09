import test from 'node:test';
import assert from 'node:assert/strict';
import { selectValidation, phases, candidateValidationPlan } from '../tools/assets/validation-plan';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { completionCommands } from '../tools/assets/finalize';
const rooms = {
  court: ['oak', 'shared-ground'],
  'upper-landing': ['altar', 'shared-ground'],
};
test('an unavailable comparison baseline selects full coverage without downloading old artwork', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-plan-cache-'));
  const previous = process.env.LANTERN_CACHE_ROOT,
    request = globalThis.fetch;
  let downloads = 0;
  process.env.LANTERN_CACHE_ROOT = root;
  globalThis.fetch = async () => {
    downloads++;
    throw new Error('Unavailable old artwork');
  };
  try {
    const plan = await candidateValidationPlan({ payload: '/unavailable-candidate' } as Parameters<
      typeof candidateValidationPlan
    >[0]);
    assert.equal(plan.full, true);
    assert.deepEqual(plan.phases, [...phases]);
    assert.equal(downloads, 0);
  } finally {
    globalThis.fetch = request;
    if (previous === undefined) delete process.env.LANTERN_CACHE_ROOT;
    else process.env.LANTERN_CACHE_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('room changes avoid packaging while shared assets select every consuming room', () => {
  const one = selectValidation({ assets: ['oak'] }, rooms);
  assert.ok(one.phases.includes('Graveyard scene'));
  assert.ok(!one.phases.includes('Chapel scene'));
  assert.ok(!one.phases.includes('Dev package'));
  assert.equal(one.phases.slice(0, 5).length, 5);
  assert.deepEqual(completionCommands('darwin', one)[0], [
    'regular local checks',
    ['run', 'check:full', '--', '--local'],
  ]);
  const both = selectValidation({ assets: ['shared-ground'] }, rooms);
  assert.ok(both.phases.includes('Graveyard scene'));
  assert.ok(both.phases.includes('Chapel scene'));
  const commands = completionCommands('darwin', both).filter(([name]) => name.endsWith(' scene'));
  assert.ok(!commands[0]![1].includes('--skip-reload'));
  assert.ok(commands[1]![1].includes('--skip-reload'));
});
test('hero, lighting and effects changes union required package and visual journeys', () => {
  const plan = selectValidation(
    { assets: ['ink-hero-current', 'oak'], lighting: true, effects: true },
    rooms,
  );
  for (const required of [
    'Game package',
    'Dev package',
    'animation smoke',
    'hero smoke',
    'Game smoke',
    'lighting smoke',
    'Effects smoke',
    'Graveyard scene',
  ] as const)
    assert.ok(plan.phases.includes(required), required);
  assert.ok(!plan.phases.includes('Chapel scene'));
});
test('unknown and shared changes, unknown rooms and explicit full mode fail closed', () => {
  for (const change of [
    { assets: [], unknown: true },
    { assets: [], shared: true },
  ])
    assert.deepEqual(selectValidation(change, rooms).phases, [...phases]);
  assert.deepEqual(selectValidation({ assets: [] }, rooms, true).phases, [...phases]);
  assert.equal(selectValidation({ assets: ['oak'] }, { future: ['oak'] }).full, true);
});

test('loading-video changes require both packages and the existing Game and Sandbox journeys', () => {
  const plan = selectValidation({ assets: [], loading: true }, {});
  for (const phase of ['Game package', 'Dev package', 'Game smoke', 'Sandbox smoke'] as const)
    assert.ok(plan.phases.includes(phase), phase);
});
