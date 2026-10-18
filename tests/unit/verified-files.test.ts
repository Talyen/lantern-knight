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

test('persisted proofs detect same-size edits with restored mtime, deletion and symlinks', async (t) => {
  const { outputVerified } = await import('../../tools/verified-files');
  const root = await temporaryDirectory(t, 'lantern-verification-identity-');
  const file = path.join(root, 'output');
  await fs.writeFile(file, 'accepted');
  await verifiedOutput(root, ['output'], async () => {});
  assert.equal(await outputVerified(root, ['output'], '.verified-output.json'), true);
  const before = await fs.stat(file);
  await fs.writeFile(file, 'modified');
  await fs.utimes(file, before.atime, before.mtime);
  assert.equal(await outputVerified(root, ['output'], '.verified-output.json'), false);
  await fs.rm(file);
  assert.equal(await outputVerified(root, ['output'], '.verified-output.json'), false);
  await fs.writeFile(path.join(root, 'outside'), 'accepted');
  await fs.symlink('outside', file);
  await assert.rejects(
    outputVerified(root, ['output'], '.verified-output.json'),
    /Invalid verified/,
  );
});
