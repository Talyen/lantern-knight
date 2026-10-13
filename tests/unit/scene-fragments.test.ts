import { temporaryDirectory } from '../fixtures/temporary-directory';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FragmentStore } from '../../tools/scene/fragment-store';
it('fragment recipes preserve sources, validate identities and reject symlink reads', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-fragment-');

  const store = new FragmentStore(root);
  const recipe = {
    version: 1,
    name: 'Lamp',
    objects: [{ id: 'lamp', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 1, z: 2 }],
  };
  const first = await store.create(recipe),
    second = await store.create(recipe);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await store.read(first.id), recipe);
  assert.equal((await store.list()).length, 2);
  await assert.rejects(() => store.read('../outside'), /identity/);
  await fs.symlink(path.join(root, first.id + '.json'), path.join(root, 'linked.json'));
  await assert.rejects(() => store.read('linked'), /Invalid fragment/);
});
