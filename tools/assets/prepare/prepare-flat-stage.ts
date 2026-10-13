import sharp from 'sharp';
import { remapAlpha } from '../pixels';
import recipe from '../../../authoring/flat-stage-art.json';
import { source } from '../definition';

import { hash } from '../../compiler';
import type { Source } from '../../../src/assets/schema';
import type { PreparationContext } from '../context';
import { preparationOutput } from '../preparation-output';
export async function prepare(context: PreparationContext, check = false) {
  const { write: output, pack } = preparationOutput(context, check);
  const { readAsset } = context;

  const root = 'references/art/' + recipe.group;
  const provenance = JSON.parse(await readAsset(root + '/provenance.json', 'utf8')) as {
    selected: { id: string; nativeSha256: string; dimensions: number[] }[];
  };
  const receipt = [];

  for (const r of recipe.frames) {
    const original = await readAsset(root + '/' + r.file),
      native = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const record = provenance.selected.find((p) => p.id + '.png' === r.file);
    if (
      !record ||
      record.nativeSha256 !== hash(original) ||
      record.dimensions.join() !== r.canvas.join() ||
      native.info.width !== r.canvas[0] ||
      native.info.height !== r.canvas[1]
    )
      throw new Error('Flat-stage native source differs: ' + r.id);
    // Registered intake removes generated low-alpha backdrop contamination only.
    // RGB, native dimensions, authored silhouette registration and originals remain intact.
    if (r.alphaRemap)
      remapAlpha(native.data, r.alphaRemap.floor, r.alphaRemap.ceiling - r.alphaRemap.floor);
    const canvas = r.canvas as [number, number],
      anchor = r.anchor as [number, number];
    const s: Source = source(r.id, r.type as Source['asset']['type'], canvas, anchor, r.density);
    Object.assign(s.asset, {
      contentVersion: 'flat-stage-v1',
      recipe: 'flat-stage-native-v1',
      projection: r.projection,
      atlasSize: r.type === 'material' ? canvas[0] : 2048,
      padding: r.type === 'material' ? 0 : 4,
      sampling: r.type === 'material' ? 'terrain-mipmapped' : undefined,
      occlusion:
        r.projection === 'top-down' ? 'ground-plane-v1' : 'vertical-plane-preserved-projection-v1',
      limitations: [
        'Requested maximum native size; built-in tool supplied the recorded dimensions. No raster enlargement.',
      ],
      provenance: {
        creator:
          'Built-in image_gen; canonical Clean INK; requested gpt-image-2.5 sunburst; routing not exposed',
        license: 'Owner-authorized project artwork',
        source: root,
      },
      requiredClips: [r.clip],
      clips: {
        [r.clip]: { d45: { frames: [r.clip], durationsMs: [1000], loop: true, notifies: [] } },
      },
    });
    s.frames = [
      { id: r.clip, path: `ink/${r.id}/${r.clip}.png`, origin: 'imported-study', attachments: {} },
    ];
    await output(
      'staging/' + s.frames[0]!.path,
      await sharp(native.data, { raw: native.info }).png().toBuffer(),
    );
    await pack(s);
    receipt.push({
      pack: r.id,
      id: r.clip,
      source: root + '/' + r.file,
      sourceHash: hash(original),
      sourceCanvas: canvas,
      derivativeCanvas: canvas,
      uniformScale: 1,
      density: r.density,
      minimumSourceDensity: r.density,
      alphaRemap: r.alphaRemap,
      sourceAnchor: anchor,
      derivativeAnchor: anchor,
    });
  }
  await output(
    'staging/ink/flat-stage-receipt.json',
    JSON.stringify(
      { recipe: 'flat-stage-native-v1', originalsPreserved: true, frames: receipt },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `${check ? 'Verified' : 'Prepared'} ${recipe.frames.length} native flat-stage assets without raster enlargement`,
  );
}
