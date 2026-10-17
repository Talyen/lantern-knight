import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { verifiedOutput } from '../../tools/verified-files';

test('invalid validation receipts require a fresh proof and can be repaired', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-verification-receipt-');
  await fs.writeFile(path.join(root, 'output'), 'accepted bytes');
  let validations = 0;
  const validate = async () => {
    validations++;
  };
  for (const receipt of ['null', '{', '[]', '{"version":1,"key":false}']) {
    await fs.writeFile(path.join(root, '.verified-output.json'), receipt);
    assert.equal(await verifiedOutput(root, ['output'], validate), false);
    assert.equal(await verifiedOutput(root, ['output'], validate), true);
  }
  assert.equal(validations, 4);
  await fs.writeFile(path.join(root, 'output'), 'changed bytes');
  await assert.rejects(
    verifiedOutput(root, ['output'], async () => {
      throw new Error('invalid output');
    }),
    /invalid output/,
  );
  assert.equal(await verifiedOutput(root, ['output'], validate), false);
  assert.equal(validations, 5);
});
