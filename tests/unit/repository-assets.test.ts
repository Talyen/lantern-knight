import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { saveRepositoryAssets, openRepositoryWorkspace } from '../../tools/assets/repository';
import { payloadDigest, type PackInventory } from '../../tools/assets/pack';
import { importSources } from '../../tools/assets/import';
import { sourceLibrary } from '../../tools/assets/paths';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-repository-'));
  const source = path.join(root, 'prepared');
  await fs.mkdir(path.join(root, 'assets'));
  const files: PackInventory['files'] = {};
  for (const name of [
    'public/generated/library/catalog.json',
    'public/pages/unused.png',
    'metadata/original.json',
  ]) {
    const bytes = Buffer.from(name.endsWith('.png') ? 'exact native pixels' : name);
    const target = path.join(source, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    files[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  const inventory: PackInventory = { schemaVersion: 1, recipeSha256: hash('recipe'), files };
  const preparation = {
    inputs: {},
    recipeSha256: hash('{}'),
    payloadSha256: payloadDigest(inventory),
  };
  const pin = await saveRepositoryAssets(source, inventory, preparation, root);
  if (pin.schemaVersion !== 5) throw new Error('Expected repository pin');
  return {
    root,
    source,
    inventory,
    preparation,
    pin,
    async close() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('the complete authoring snapshot survives without source paths, network or shared cache', async () => {
  const f = await fixture();
  try {
    await fs.rm(f.source, { recursive: true });
    const workspace = await openRepositoryWorkspace(f.pin, 'authoring', false, f.root);
    try {
      for (const [name, info] of Object.entries(f.inventory.files))
        assert.equal(hash(await fs.readFile(path.join(workspace.root, name))), info.sha256);
      await fs.writeFile(
        path.join(workspace.root, 'public/pages/unused.png'),
        'corrupted assembly',
      );
    } finally {
      await workspace.release();
    }
    await fs.rm(path.join(f.root, '.cache'), { recursive: true });
    const again = await openRepositoryWorkspace(f.pin, 'authoring', true, f.root);
    assert.equal(await again.ensurePublicFile('pages/unused.png'), true);
    assert.equal(
      (await fs.readFile(path.join(again.publicDirectory, 'pages/unused.png'))).toString(),
      'exact native pixels',
    );
    await again.release();
    await assert.rejects(again.ensurePublicFile('pages/unused.png'), /closed/);
  } finally {
    await f.close();
  }
});

test('missing or corrupt owned bytes fail locally and unsafe inventories cannot activate', async () => {
  const f = await fixture();
  try {
    const info = f.inventory.files['public/pages/unused.png']!;
    const object = path.join(f.root, 'asset-data/objects', info.sha256.slice(0, 2), info.sha256);
    await fs.writeFile(object, 'bad bytes');
    const workspace = await openRepositoryWorkspace(f.pin, 'authoring', true, f.root);
    await assert.rejects(workspace.ensurePublicFile('pages/unused.png'), /corrupt/);
    assert.throws(() => workspace.ensurePublicFile('../outside'), /Unsafe/);
    await workspace.release();
    const before = await fs.readFile(path.join(f.root, 'assets/lock.json'));
    await assert.rejects(
      saveRepositoryAssets(
        f.source,
        { ...f.inventory, files: { '../escape': info } },
        f.preparation,
        f.root,
      ),
      /Unsafe/,
    );
    assert.deepEqual(await fs.readFile(path.join(f.root, 'assets/lock.json')), before);
    const inventory = path.join(
      f.root,
      'asset-data/inventories',
      f.pin.inventorySha256 + '.json.gz',
    );
    await fs.writeFile(inventory, 'corrupt');
    await assert.rejects(
      openRepositoryWorkspace(f.pin, 'authoring', true, f.root),
      /inventory differs/,
    );
  } finally {
    await f.close();
  }
});

test('imports own independent originals and metadata; collisions fail before adding any files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-import-'));
  try {
    const source = path.join(root, 'Documents/kit'),
      owned = path.join(root, 'repository');
    await fs.mkdir(path.join(source, '.lantern'), { recursive: true });
    await fs.writeFile(path.join(source, 'painting.png'), 'original');
    await fs.writeFile(path.join(source, '.lantern/identities.json'), 'stable IDs');
    assert.equal(await importSources(source, 'Lantern Knight/kit', owned), 2);
    await fs.writeFile(path.join(source, 'painting.png'), 'external revision');
    await fs.writeFile(path.join(source, 'new.png'), 'new addition');
    await assert.rejects(importSources(source, 'Lantern Knight/kit', owned), /conflicts/);
    assert.equal(
      (await fs.readFile(path.join(owned, 'Lantern Knight/kit/painting.png'))).toString(),
      'original',
    );
    await assert.rejects(fs.access(path.join(owned, 'Lantern Knight/kit/new.png')));
    await fs.rm(path.join(root, 'Documents'), { recursive: true });
    assert.equal(
      (
        await fs.readFile(path.join(owned, 'Lantern Knight/kit/.lantern/identities.json'))
      ).toString(),
      'stable IDs',
    );
    assert.equal(sourceLibrary({ ASSET_LIBRARY_ROOT: '/missing/external' }), sourceLibrary({}));
    await fs.mkdir(source, { recursive: true });
    await fs.symlink(
      path.join(owned, 'Lantern Knight/kit/painting.png'),
      path.join(source, 'link.png'),
    );
    await assert.rejects(importSources(source, 'Other', owned), /symlinks/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('retention follows saved scenes and explicit additions without retaining the available library', async () => {
  const { retainedAssetCatalog } = await import('../../tools/assets/selection');
  const { emptyScene } = await import('../../src/editor/default-scene');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-retention-'));
  try {
    await fs.mkdir(path.join(root, 'authoring/scenes'), { recursive: true });
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'assets/retained.json'), JSON.stringify({ assets: [] }));
    const scene = emptyScene();
    scene.objects.push({
      id: 'retained-prop',
      kind: 'prop',
      asset: 'library-in-scene',
      clip: 'still',
      heading: 'd45',
      x: 0,
      z: 0,
    });
    await fs.writeFile(
      path.join(root, 'authoring/scenes/unregistered.json'),
      JSON.stringify(scene),
    );
    const available = Object.fromEntries(
      ['library-in-scene', 'library-unused', 'library-explicit'].map((id) => [
        id,
        `generated/library/${id}/manifest.json`,
      ]),
    );
    const catalog = await retainedAssetCatalog(available, root, ['library-explicit']);
    assert.equal(catalog['library-in-scene'], available['library-in-scene']);
    assert.equal(catalog['library-explicit'], available['library-explicit']);
    assert.equal(catalog['library-unused'], undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inactive actor reviews can remain archived without weakening active scale validation', async () => {
  const { validateScaleCoverage } = await import('../../tools/assets/library-scale');
  const recipe = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'authoring/actor-scale.json'), 'utf8'),
  );
  assert.doesNotThrow(() => validateScaleCoverage([], recipe, new Set()));
  const id = Object.keys(recipe.assets)[0]!;
  assert.throws(
    () => validateScaleCoverage([], recipe, new Set([id])),
    /Unknown actor scale asset/,
  );
});
