import { sourceFixture } from '../fixtures/source';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { diskBytes } from '../../tools/assets/cache';
import { createPreparationContext } from '../../tools/assets/context';
import { preparationOutput } from '../../tools/assets/preparation-output';

test('one explicit writer accounts for replacement/concurrent writes and confines output', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-context-');

  const options = { workspace: root, budget: 8, sourceRoot: root, libraryRoot: root };
  const context = await createPreparationContext(options);
  await context.writeAsset('public/a.txt', '1234');
  await Promise.all([
    context.writeAsset('public/a.txt', '12'),
    context.writeAsset('public/b.txt', '123456'),
  ]);
  assert.equal(await context.readAsset('public/a.txt', 'utf8'), '12');
  await assert.rejects(context.writeAsset('public/c.txt', '1'), /reserved cache space/);
  await assert.rejects(fs.access(path.join(root, 'public/c.txt')));
  await fs.link(path.join(root, 'public/a.txt'), path.join(root, 'public/candidate.txt'));
  assert.equal(await diskBytes(root), 8);
  assert.equal(await context.readAsset('public/b.txt', 'utf8'), '123456');
  const other = await createPreparationContext({ ...options, budget: 32 });
  await assert.rejects(other.writeAsset('docs/escaped.txt', 'x'), /escapes workspace/);
  const symlink = await createPreparationContext({ ...options, budget: 32 });
  await fs.symlink(os.tmpdir(), path.join(root, 'public/escape'));
  await assert.rejects(symlink.writeAsset('public/escape/escape.txt', 'x'), /symlink/);
});
test('compiler writes share the preparation budget and record atlas output without ambient state', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-context-compiler-');

  const source = sourceFixture();
  await fs.mkdir(path.join(root, 'staging'));
  await fs.writeFile(path.join(root, 'staging/source.json'), JSON.stringify(source));
  await sharp({
    create: {
      width: source.asset.canvas[0],
      height: source.asset.canvas[1],
      channels: 4,
      background: { r: 170, g: 70, b: 20, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(root, 'staging/sample.png'));
  const outputLog = path.join(os.tmpdir(), path.basename(root) + '.log');
  const options = {
    workspace: root,
    budget: 1024 * 1024,
    sourceRoot: root,
    libraryRoot: root,
    outputLog,
  };
  try {
    const context = await createPreparationContext(options);
    const manifest = await context.compile('source.json', 'public/generated');
    assert.ok(
      (await fs.readFile(outputLog, 'utf8')).includes(
        'public/generated/' + manifest.pages[0]!.path,
      ),
    );
    const before = await fs.readFile(path.join(root, 'public/generated/manifest.json'));
    const check = preparationOutput(
      {
        ...context,
        writeAsset: async () => {
          throw new Error('Check must not write');
        },
      },
      true,
    );
    await check.write('staging/source.json', JSON.stringify(source));
    await assert.rejects(check.write('staging/source.json', 'changed'), /Stale prepared output/);
    await check.compile('source.json', 'public/generated');
    const page = path.join(root, 'public/generated', manifest.pages[0]!.path);
    const pixels = await fs.readFile(page);
    await fs.writeFile(page, 'corrupt');
    await assert.rejects(check.compile('source.json', 'public/generated'), /Stale prepared page/);
    await fs.writeFile(page, pixels);
    await fs.writeFile(path.join(root, 'public/generated/manifest.json'), '{}');
    await assert.rejects(
      check.compile('source.json', 'public/generated'),
      /Stale prepared manifest/,
    );
    await fs.writeFile(path.join(root, 'public/generated/manifest.json'), before);
    const limited = await createPreparationContext({ ...options, budget: 1 });
    await assert.rejects(
      limited.compile('source.json', 'public/generated'),
      /reserved cache space/,
    );
    assert.deepEqual(await fs.readFile(path.join(root, 'public/generated/manifest.json')), before);
  } finally {
    await fs.rm(outputLog, { force: true });
  }
});

test('replacing an existing internal hardlink counts the retained bytes as well as its replacement', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-context-links-');

  await fs.mkdir(path.join(root, 'public'));
  await fs.writeFile(path.join(root, 'public/a'), '1234');
  await fs.link(path.join(root, 'public/a'), path.join(root, 'public/b'));
  const context = await createPreparationContext({
    workspace: root,
    sourceRoot: root,
    libraryRoot: root,
    budget: 8,
  });
  await context.writeAsset('public/a', '5678');
  await assert.rejects(context.writeAsset('public/c', 'x'), /reserved cache space/);
  assert.equal(await context.readAsset('public/b', 'utf8'), '1234');
});
