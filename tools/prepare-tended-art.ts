import sharp from 'sharp';
import { readAsset, writeAsset } from './assets/io';
import { compile, hash } from './compiler';
import type { Source } from '../src/assets/schema';

const check = process.argv.includes('--check');
const recipe = JSON.parse(await readAsset('authoring/graveyard-art.json', 'utf8')) as {
  group: string;
  alphaRemap: { floor: number; ceiling: number };
  padding: number;
  frames: { id: string; canvas: [number, number]; anchor: [number, number]; density: number }[];
};
const root = `references/art/${recipe.group}`,
  template = JSON.parse(await readAsset('staging/ink/ink-scenery.json', 'utf8')) as Source;
const provenance = JSON.parse(await readAsset(`${root}/provenance.json`, 'utf8')) as {
  selected: { id: string; nativeSha256: string; dimensions: number[] }[];
};
const receipts = [];
async function output(file: string, bytes: Buffer | string) {
  if (check) {
    if (!Buffer.from(bytes).equals(await readAsset(file)))
      throw new Error(`stale tended artwork: ${file}`);
  } else await writeAsset(file, bytes);
}
for (const r of recipe.frames) {
  const file = `${r.id}-v1.png`,
    original = await readAsset(`${root}/${file}`),
    native = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    record = provenance.selected.find((p) => p.id === r.id);
  if (
    !record ||
    record.nativeSha256 !== hash(original) ||
    record.dimensions.join(',') !== r.canvas.join(',') ||
    native.info.width !== r.canvas[0] ||
    native.info.height !== r.canvas[1]
  )
    throw new Error(`tended native source differs: ${r.id}`);
  // Generated soft backdrop is confined to low alpha. Preserve native RGB and
  // restore the solid silhouette; transparent padding adds no invented detail.
  for (let i = 3; i < native.data.length; i += 4) {
    const t = Math.max(
      0,
      Math.min(
        1,
        (native.data[i]! / 255 - recipe.alphaRemap.floor) /
          (recipe.alphaRemap.ceiling - recipe.alphaRemap.floor),
      ),
    );
    native.data[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  const pad = recipe.padding,
    canvas: [number, number] = [r.canvas[0] + pad * 2, r.canvas[1] + pad * 2],
    anchor: [number, number] = [r.anchor[0] + pad, r.anchor[1] + pad],
    id = `ink-tended-${r.id}`;
  const png = await sharp(native.data, { raw: native.info })
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const source: Source = {
    schemaVersion: 2,
    asset: {
      ...template.asset,
      id,
      canvas,
      anchor,
      density: r.density,
      atlasSize: 4096,
      contentVersion: 'last-tended-light-v1',
      recipe: 'tended-native-cutouts-v1',
      provenance: {
        creator:
          'Built-in image_gen; canonical Clean INK; requested gpt-image-2.5 sunburst; routing not exposed',
        license: 'Owner-authorized project artwork',
        source: root,
      },
      requiredClips: [r.id],
      clips: { [r.id]: { d45: { frames: [r.id], durationsMs: [1000], loop: true, notifies: [] } } },
    },
    frames: [
      { id: r.id, path: `ink/${id}/${r.id}.png`, origin: 'imported-study', attachments: {} },
    ],
  };
  await output(`staging/ink/${id}/${r.id}.png`, png);
  await output(`staging/ink/${id}.json`, JSON.stringify(source, null, 2) + '\n');
  const compiled = await compile(`ink/${id}.json`, `public/generated/ink/${id}`, false, check);
  if (
    check &&
    JSON.stringify(compiled) !==
      JSON.stringify(
        JSON.parse(await readAsset(`public/generated/ink/${id}/manifest.json`, 'utf8')),
      )
  )
    throw new Error(`stale tended manifest: ${id}`);
  receipts.push({
    pack: id,
    id: r.id,
    source: `${root}/${file}`,
    sourceHash: hash(original),
    sourceCanvas: r.canvas,
    derivativeCanvas: canvas,
    uniformScale: 1,
    paddingOffset: [pad, pad],
    sourceAnchor: r.anchor,
    derivativeAnchor: anchor,
    density: r.density,
    alphaRemap: recipe.alphaRemap,
  });
}
await output(
  'staging/ink/tended-art-receipt.json',
  JSON.stringify(
    { recipe: 'tended-native-cutouts-v1', frames: receipts, originalsPreserved: true },
    null,
    2,
  ) + '\n',
);
console.log(
  `${check ? 'Verified' : 'Prepared'} ${receipts.length} native Clean INK Graveyard cutouts and clean alpha`,
);
