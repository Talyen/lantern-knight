import sharp from 'sharp';
import { hash } from '../../compiler';
import type { PreparationContext } from '../context';
export async function prepare(context: PreparationContext, check = false) {
  const { readAsset, writeAsset, mkdirAsset } = context;

  const source = 'references/art/ink-collection-01/volume_02_gothic/assets/arch_gothic_wall_01.png',
    root = 'staging/rest';

  const native = await readAsset(source),
    image = await sharp(native).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    width = 1024,
    height = 512,
    out = Buffer.alloc(width * height * 4);
  // This selected painted face is a parallelogram. Recover its front-view RGB with
  // recorded bilinear source coordinates; source alpha is not a hole in solid masonry.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1),
        v = y / (height - 1),
        px = 283 + 1125 * u,
        py = 626 - 321 * u + 313 * v,
        ix = Math.floor(px),
        iy = Math.floor(py),
        fx = px - ix,
        fy = py - iy,
        index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++)
            value +=
              image.data[((iy + dy) * image.info.width + ix + dx) * 4 + channel]! *
              (dx ? fx : 1 - fx) *
              (dy ? fy : 1 - fy);
        out[index + channel] = Math.round(value);
      }
      out[index + 3] = 255;
    }
  const png = await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const receipt = {
    recipe: 'authored-masonry-face-v1',
    source,
    sourceSha256: hash(native),
    sourceCorners: [
      [283, 626],
      [1408, 305],
      [1408, 618],
      [283, 939],
    ],
    outputCanvas: [width, height],
    worldRepeatMetres: [3.2, 1.1],
    minimumSourceDensity: 313 / 1.1,
    outputSha256: hash(png),
    operation:
      'Bilinear deprojection of original wall-face RGB into opaque structural material; source unchanged.',
  };
  const metadata = JSON.stringify(receipt, null, 2) + '\n';
  if (check) {
    if (
      !(await readAsset(`${root}/limestone-face.png`)).equals(png) ||
      !(await readAsset(`${root}/receipt.json`)).equals(Buffer.from(metadata))
    )
      throw new Error('authored masonry derivative is stale');
  } else {
    await mkdirAsset(root, { recursive: true });
    await writeAsset(`${root}/limestone-face.png`, png);
    await writeAsset(`${root}/receipt.json`, metadata);
  }
  console.log(`${check ? 'Verified' : 'Prepared'} authored limestone wall face`);
}
