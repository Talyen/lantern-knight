import { derivedSource, stillFrame } from '../definition';
import sharp from 'sharp';
import { hash } from '../../compiler';
import overlayClips from '../../../authoring/ground-overlays.json';
import type { Source } from '../../../src/assets/schema';
import type { PreparationContext } from '../context';
import { preparationOutput } from '../preparation-output';
export async function prepare(context: PreparationContext, check = false) {
  const { write, pack } = preparationOutput(context, check);
  const { readAsset } = context;

  const root = 'references/art/ink-collection-01';
  const inputs: Record<string, string> = {};
  async function pixels(file: string, brightness = 1, saturation = 1) {
    const b = await readAsset(file);
    inputs[file] = hash(b);
    return sharp(b)
      .modulate({ brightness, saturation })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  }
  const grass = await pixels('references/art/blackwood-churchyard-v2/quiet-earth.png', 0.88, 0.6);
  const earth = await pixels('references/art/blackwood-churchyard-v2/quiet-earth.png', 1.02, 0.45);
  const paving = await pixels(
    `${root}/Ground_Surfaces_Decals_r02a/png/materials/03_worn_cobble.png`,
    1.02,
    0.6,
  );
  const apron = await pixels(
    `${root}/Ground_Surfaces_Decals_r02a/png/materials/01_old_flagstone.png`,
    0.82,
    0.6,
  );
  const overlays = await Promise.all(
    overlayClips.map(async (clip) => ({
      placement: { clip },
      image: await pixels(
        `${root}/${clip.startsWith('t') ? 'Ground_Transitions/png/overlays' : 'Ground_Surfaces_Decals_r02a/png/decals'}/${clip}.png`,
        0.88,
        0.7,
      ),
    })),
  );

  const template = JSON.parse(await readAsset('staging/ink/ink-moss.json', 'utf8')) as Source;
  const materials: Source = derivedSource(template, {
    id: 'ink-graveyard-materials',
    contentVersion: 'graveyard-v1',
    canvas: [1024, 1024],
    anchor: [512, 512],
    density: 256,
    atlasSize: 1024,
    padding: 0,
    sampling: 'terrain-mipmapped',
    recipe: 'graveyard-ground-materials-v1',
  });
  for (const [id, im] of [
    ['grass', grass],
    ['earth', earth],
    ['paving', paving],
    ['apron', apron],
  ] as const) {
    const file = `ink/ink-graveyard-materials/${id}.png`;
    await write(
      `staging/${file}`,
      await sharp(im.data, { raw: im.info }).resize(1024, 1024).png().toBuffer(),
    );
    stillFrame(materials, id, file);
  }
  await pack(materials);
  const overlayPack: Source = derivedSource(template, {
    id: 'ink-graveyard-overlays',
    type: 'prop',
    contentVersion: 'graveyard-v1',
    canvas: [1024, 1024],
    anchor: [512, 512],
    density: 256,
    atlasSize: 4096,
    renderCategory: 'translucent',
    occlusion: 'ground-plane-v1',
    sampling: undefined,
    recipe: 'graveyard-ground-overlays-v1',
  });
  for (const { placement: p, image: im } of overlays) {
    const file = `ink/ink-graveyard-overlays/${p.clip}.png`;
    await write(`staging/${file}`, await sharp(im.data, { raw: im.info }).png().toBuffer());
    stillFrame(overlayPack, p.clip, file);
  }
  await pack(overlayPack);
  await write(
    'staging/ink/graveyard-ground-receipt.json',
    JSON.stringify(
      {
        recipe: 'blackwood-materials-v3',
        inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
        originalSourcesPreserved: true,
        runtimeSamplerSize: 1024,
      },
      null,
      2,
    ) + '\n',
  );
}
