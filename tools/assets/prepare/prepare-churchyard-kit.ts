import sharp from 'sharp';
import { alphaBounds } from '../pixels';
import { hash } from '../../compiler';
import type { Source } from '../../../src/assets/schema';
import contract from '../../../src/assets/camera.json';
import type { PreparationContext } from '../context';
import { preparationOutput } from '../preparation-output';
export async function prepare(context: PreparationContext, check = false) {
  const { readAsset, writeAsset } = context;
  const { write, pack } = preparationOutput(context, check);

  const root = 'references/art/blackwood-churchyard-v2',
    receipt = [];
  const template = JSON.parse(await readAsset('staging/ink/ink-scenery.json', 'utf8')) as Source;
  for (const [id, file, kind] of [
    ['ink-chapel-front', 'chapel-front.png', 'facade'],
    ['ink-blackwood-oak', 'ancient-oak.png', 'oak'],
    ['ink-churchyard-roof', 'slate-roof.png', 'roof'],
    ['ink-blackwood-woodland', 'woodland-group.png', 'woodland'],
  ] as const) {
    const b = await readAsset(`${root}/${file}`),
      raw = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = alphaBounds(raw.data, raw.info.width, raw.info.height, 180);
    if (!bounds) throw new Error('Empty churchyard silhouette: ' + file);
    const { minX, maxX, minY, maxY } = bounds;
    const source: Source = {
      schemaVersion: 2,
      asset: {
        ...template.asset,
        id,
        type: kind === 'roof' ? 'material' : 'prop',
        canvas: kind === 'roof' ? [1024, 1024] : [raw.info.width, raw.info.height],
        sampling: kind === 'roof' ? 'terrain-mipmapped' : undefined,
        anchor:
          kind === 'roof'
            ? [512, 512]
            : kind === 'oak' || kind === 'woodland'
              ? [(minX + maxX) / 2, maxY]
              : [raw.info.width / 2, raw.info.height],
        density:
          kind === 'oak' || kind === 'woodland'
            ? (maxY - minY) /
              ((kind === 'woodland' ? 4.1 : 5.8) *
                Math.cos((contract.elevationDeg * Math.PI) / 180))
            : 256,
        atlasSize: kind === 'roof' ? 1024 : 2048,
        projection:
          kind === 'roof' ? 'top-down' : kind === 'facade' ? 'front-view' : 'painted-cutout',
        renderCategory: kind === 'roof' ? 'opaque' : 'cutout',
        contentVersion: 'blackwood-v2',
        provenance: {
          creator:
            'Built-in image_gen; canonical Clean INK prompt; model requested gpt-image-2.5 sunburst; routing not exposed',
          license: 'Owner-authorized project artwork',
          source: root,
        },
        recipe: 'blackwood-kit-v2',
        requiredClips: [kind],
        clips: {
          [kind]: { d45: { frames: [kind], durationsMs: [1000], loop: true, notifies: [] } },
        },
      },
      frames: [
        { id: kind, path: `ink/${id}/${kind}.png`, origin: 'imported-study', attachments: {} },
      ],
    };
    const folder = `staging/ink/${id}`;
    const staged = await (kind === 'roof' ? sharp(b).resize(1024, 1024) : sharp(b))
      .ensureAlpha()
      .png()
      .toBuffer();
    await write(`${folder}/${kind}.png`, staged);
    await pack(source);
    receipt.push({
      id,
      file,
      sha256: hash(b),
      width: raw.info.width,
      height: raw.info.height,
      density: source.asset.density,
    });
    console.log(`${check ? 'Verified' : 'Prepared'} ${id}`);
  }
  const groundBytes = await readAsset(`${root}/quiet-earth.png`),
    groundInfo = await sharp(groundBytes).metadata();
  receipt.push({
    id: 'ink-graveyard-materials',
    file: 'quiet-earth.png',
    sha256: hash(groundBytes),
    width: groundInfo.width!,
    height: groundInfo.height!,
    density: 256,
  });
  if (!check)
    await writeAsset(
      'staging/ink/churchyard-source-proof.json',
      JSON.stringify(
        {
          tool: 'built-in image_gen',
          requestedModel: 'gpt-image-2.5 sunburst',
          modelRoutingExposed: false,
          requestedResolution: 'highest supported native',
          sizeControlExposed: false,
          originalsPreserved: true,
          assets: receipt,
        },
        null,
        2,
      ) + '\n',
    );
}
