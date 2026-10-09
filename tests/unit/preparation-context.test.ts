import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createPreparationContext } from '../../tools/assets/context';

test('one explicit writer accounts for replacement/concurrent writes and confines output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-context-'));
  try {
    const options = { workspace: root, budget: 8, sourceRoot: root, libraryRoot: root };
    const context = await createPreparationContext(options);
    await context.writeAsset('public/a.txt', '1234');
    await Promise.all([
      context.writeAsset('public/a.txt', '12'),
      context.writeAsset('public/b.txt', '123456'),
    ]);
    assert.equal(await context.readAsset('public/a.txt', 'utf8'), '12');
    await assert.rejects(context.writeAsset('public/c.txt', '1'), /reserved cache space/);
    assert.equal(await context.readAsset('public/b.txt', 'utf8'), '123456');
    const other = await createPreparationContext({ ...options, budget: 32 });
    await assert.rejects(other.writeAsset('docs/escaped.txt', 'x'), /escapes workspace/);
    const symlink = await createPreparationContext({ ...options, budget: 32 });
    await fs.symlink(os.tmpdir(), path.join(root, 'public/escape'));
    await assert.rejects(symlink.writeAsset('public/escape/escape.txt', 'x'), /symlink/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('compiler writes share the preparation budget and record atlas output without ambient state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-context-compiler-'));
  try {
    const source = JSON.parse(await fs.readFile('tests/fixtures/valid.json', 'utf8'));
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
      const limited = await createPreparationContext({ ...options, budget: 1 });
      await assert.rejects(
        limited.compile('source.json', 'public/generated'),
        /reserved cache space/,
      );
      assert.deepEqual(
        await fs.readFile(path.join(root, 'public/generated/manifest.json')),
        before,
      );
    } finally {
      await fs.rm(outputLog, { force: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('replacing an existing internal hardlink counts the retained bytes as well as its replacement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-context-links-'));
  try {
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
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
