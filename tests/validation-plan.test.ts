import test from 'node:test';
import assert from 'node:assert/strict';
import { selectValidation, phases } from '../tools/assets/validation-plan';
import { completionCommands } from '../tools/assets/finalize';
const rooms = {
  court: ['oak', 'shared-ground'],
  'upper-landing': ['altar', 'shared-ground'],
};
test('room changes avoid packaging while shared assets select every consuming room', () => {
  const one = selectValidation({ assets: ['oak'] }, rooms);
  assert.ok(one.phases.includes('Graveyard scene'));
  assert.ok(!one.phases.includes('Chapel scene'));
  assert.ok(!one.phases.includes('Dev package'));
  assert.equal(one.phases.slice(0, 5).length, 5);
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
