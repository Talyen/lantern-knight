import path from 'node:path';
import sharp from 'sharp';
import { hash } from '../../compiler';
import type { Source } from '../../../src/assets/schema';
import contract from '../../../src/assets/camera.json';
import { cameraAxes } from '../../../src/assets/camera-calibration';
import type { PreparationContext } from '../context';
export async function prepare(context: PreparationContext, check = false) {
  const { readAsset, writeAsset, mkdirAsset, compile, exactSource } = context;

  const { right, up, outward } = cameraAxes();

  const root = 'references/art/ink-collection-01';

  const receipt: { file: string; hash: string }[] = [],
    emitters: Record<string, number[]> = {};
  async function write(file: string, data: Buffer | string) {
    if (check) {
      if (!Buffer.from(data).equals(await readAsset(file)))
        throw new Error(`stale playground derivative: ${file}`);
    } else {
      await mkdirAsset(path.dirname(file), { recursive: true });
      await writeAsset(file, data);
    }
  }
  function source(
    id: string,
    type: 'effect' | 'prop',
    canvas: [number, number],
    anchor: [number, number],
    density: number,
  ): Source {
    return {
      schemaVersion: 2,
      asset: {
        id,
        type,
        schemaVersion: 2,
        contentVersion: 'effects-lab-1',
        bundle: 'room',
        status: 'proxy',
        viewMode: 'fixed-authored',
        projection: canvas[1] === 1536 ? 'painted-cutout' : 'projected-world',
        allowEmptyFrames: type === 'effect',
        atlasSize: 2048,
        limitations: ['Developer look-development scene; effects have no gameplay authority.'],
        provenance: {
          creator: 'Owner-supplied Lantern collection',
          license: 'Original owner-supplied artwork provenance retained',
          source: root,
        },
        contractId: contract.id,
        bakeVersion: contract.bakeVersion,
        canvas,
        density,
        anchor,
        padding: 4,
        colorSpace: 'srgb',
        alpha: 'straight',
        recipe: 'effects-playground-v1',
        designReference: 'collection-study',
        renderStyle: 'clean-ink',
        renderCategory: type === 'effect' ? 'translucent' : 'cutout',
        shadow: { radius: 0.3, opacity: 0.3 },
        collisionFootprint: 'none',
        occlusion: 'camera-card-v1',
        fallbacks: {},
        dependencies: [],
        requiredClips: ['show'],
        clips: {},
      },
      frames: [],
    };
  }
  async function frames(
    pack: Source,
    files: string[],
    durations: number[],
    loop: boolean,
    vector = false,
  ) {
    const ids = [];
    for (const [i, file] of files.entries()) {
      const input = await exactSource(file, root);
      receipt.push({ file, hash: hash(input) });
      const png = vector
        ? await sharp(input, { density: 216 }).ensureAlpha().png().toBuffer()
        : input;
      const id = `frame-${i}`,
        relative = `effects-playground/${pack.asset.id}/${id}.png`;
      await write(path.join('staging', relative), png);
      pack.frames.push({ id, path: relative, origin: 'imported-study', attachments: {} });
      ids.push(id);
    }
    pack.asset.clips.show = { d45: { frames: ids, durationsMs: durations, loop, notifies: [] } };
    const sourcePath = `effects-playground/${pack.asset.id}.json`;
    await write(path.join('staging', sourcePath), JSON.stringify(pack, null, 2) + '\n');
    const out = `public/generated/dev-effects/${pack.asset.id}`,
      manifest = await compile(sourcePath, out, false, check);
    if (check) {
      if (
        JSON.stringify(manifest) !==
        JSON.stringify(JSON.parse(await readAsset(`${out}/manifest.json`, 'utf8')))
      )
        throw new Error(`stale playground pack ${pack.asset.id}`);
      for (const page of manifest.pages)
        if (hash(await readAsset(path.join(out, page.path))) !== page.hash)
          throw new Error('playground page changed');
    }
    console.log(`${check ? 'Verified' : 'Prepared'} ${pack.asset.id}: ${ids.length} frames`);
  }
  const lighting = JSON.parse(
    (await exactSource('Lantern_Lighting03_CleanInk/manifest.json', root)).toString(),
  );
  for (const [id, native] of [
    ['watch', 'watch_lantern'],
    ['brazier', 'tripod_brazier'],
    ['votive', 'votive_candelabrum'],
  ] as const) {
    const asset = lighting.assets.find((a: { id: string }) => a.id === native),
      anchor = asset.states.unlit.ground_pivot_px as [number, number];
    await frames(
      source(`fx-${id}-body`, 'prop', [1536, 1536], anchor, 440),
      [`Lantern_Lighting03_CleanInk/${asset.states.unlit.png}`],
      [1000],
      true,
    );
    const files = Array.from(
      { length: 24 },
      (_, i) =>
        `Lantern_Lighting03_CleanInk/animation/${native}/emission_${String(i).padStart(3, '0')}.png`,
    );
    await frames(
      source(`fx-${id}-flame`, 'effect', [1536, 1536], anchor, 440),
      files,
      files.map(() => 1000 / 12),
      true,
    );
    const image = await sharp(await exactSource(files[0]!, root))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0,
      x = 0,
      y = 0;
    for (let py = 0; py < image.info.height; py++)
      for (let px = 0; px < image.info.width; px++) {
        const a = image.data[(py * image.info.width + px) * 4 + 3]!;
        sum += a;
        x += px * a;
        y += py * a;
      }
    const sx = (x / sum - anchor[0]) / 440,
      sy = (anchor[1] - y / sum) / 440;
    emitters[id] = right
      .clone()
      .multiplyScalar(sx)
      .addScaledVector(up, sy)
      .addScaledVector(outward, sy * Math.tan((contract.elevationDeg * Math.PI) / 180))
      .toArray();
  }
  await write('public/dev-effects/emitters.json', JSON.stringify(emitters, null, 2) + '\n');
  await write(
    'staging/effects-playground/receipt.json',
    JSON.stringify({ recipe: 'effects-playground-v1', sourceFiles: receipt }, null, 2) + '\n',
  );
}
