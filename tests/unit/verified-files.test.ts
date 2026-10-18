import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { verifiedOutput, type VerifiedFiles } from '../../tools/verified-files';

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
  await fs.utimes(file, 1_700_000_000, 1_700_000_000);
  await verifiedOutput(root, ['output'], async () => {});
  assert.equal(await outputVerified(root, ['output'], '.verified-output.json'), true);
  const before = await fs.stat(file);
  await fs.writeFile(file, 'modified');
  await fs.utimes(file, before.atime, before.mtime);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
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

test('parallel checksums preserve sorted identity, share aliases and invalidate restored timestamps', async (t) => {
  const { fileChecksums } = await import('../../tools/verified-files');
  const { createHash } = await import('node:crypto');
  const root = await temporaryDirectory(t, 'lantern-checksum-batches-');
  const expected: Record<string, string> = {};
  for (let i = 0; i < 40; i++) {
    const name = String(i).padStart(2, '0');
    const bytes = Buffer.alloc((40 - i) * 1024, i);
    await fs.writeFile(path.join(root, name), bytes);
    await fs.utimes(path.join(root, name), 1_700_000_000, 1_700_000_000);
    expected[name] = createHash('sha256').update(bytes).digest('hex');
  }
  await fs.link(path.join(root, '00'), path.join(root, 'alias'));
  expected.alias = expected['00']!;
  const proofs: VerifiedFiles = new Map();
  const names = Object.keys(expected).reverse();
  const actual = await fileChecksums(root, names, proofs);
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(proofs.size, names.length);
  assert.deepEqual(await fileChecksums(root, names, proofs), expected);
  const file = path.join(root, '00');
  const before = await fs.stat(file);
  await fs.writeFile(file, Buffer.alloc(before.size, 99));
  await fs.utimes(file, before.atime, before.mtime);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  const changed = await fileChecksums(root, names, proofs);
  assert.notEqual(changed['00'], expected['00']);
  assert.equal(changed.alias, changed['00']);
});
