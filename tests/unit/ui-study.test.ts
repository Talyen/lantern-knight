import test from 'node:test';
import assert from 'node:assert/strict';
import { fits, organize, samplePack, columns, rows } from '../../tools/ui-study/pack';

test('inventory studies use the same generous pack with separate gear and stacked supplies', () => {
  const pack = samplePack('populated');
  assert.equal(columns * rows, 192);
  assert.equal(pack.filter((item) => item.item === 'orchard-ring').length, 2);
  assert.equal(pack.find((item) => item.item === 'health-potion')?.quantity, 8);
  for (const item of pack) assert.equal(fits(pack, item, item.x, item.y), true);
  assert.deepEqual(samplePack('empty'), []);
  const full = samplePack('full');
  assert.equal(
    full.reduce((total, item) => total + item.width * item.height, 0),
    192,
  );
  for (const item of full) assert.equal(fits(full, item, item.x, item.y), true);
});

test('placement rejects overlap, fractional coordinates and bounds without moving the item', () => {
  const pack = samplePack('populated');
  const sword = pack.find((item) => item.item === 'sword')!;
  const armor = pack.find((item) => item.item === 'leather-armor')!;
  const before = structuredClone(pack);
  assert.equal(fits(pack, sword, armor.x, armor.y), false);
  for (const [x, y] of [
    [-1, 0],
    [0, -1],
    [11, 0],
    [0, 13],
    [0.5, 0],
    [0, NaN],
  ])
    assert.equal(fits(pack, sword, x!, y!), false);
  assert.equal(fits(pack, sword, 10, 12), true);
  assert.deepEqual(pack, before);
});

test('organize is deterministic, retains every item and leaves input unchanged on failure', () => {
  const pack = samplePack('populated');
  const before = structuredClone(pack);
  const result = organize([...pack].reverse())!;
  assert.deepEqual(result, organize(pack));
  assert.deepEqual(
    result
      .map(({ key, item, quantity }) => ({ key, item, quantity }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    pack
      .map(({ key, item, quantity }) => ({ key, item, quantity }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
  assert.deepEqual(pack, before);
  const impossible = [...samplePack('full'), { ...pack[0]!, key: 'extra' }];
  const snapshot = structuredClone(impossible);
  assert.equal(organize(impossible), undefined);
  assert.deepEqual(impossible, snapshot);
});
