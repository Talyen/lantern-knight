import sharp from 'sharp';
import recipe from '../authoring/flat-stage-art.json';
import { readAsset, writeAsset } from './assets/io';
import { hash } from './compiler';

// Diagnostic contact proof only. Whole native ground panels remain intact;
// production composition and joins are inspected through scene:check with requested captures.
const frames = recipe.frames.filter((r) => r.projection === 'top-down');
const bytes = await Promise.all(
  frames.map((r) => readAsset(`references/art/${recipe.group}/${r.file}`)),
);
const width = frames.reduce((sum, r) => sum + r.canvas[0]!, 0),
  height = Math.max(...frames.map((r) => r.canvas[1]!));
let left = 0;
const layers = frames.map((r, i) => {
  const layer = { input: bytes[i]!, left, top: 0 };
  left += r.canvas[0]!;
  return layer;
});
const proof = await sharp({
  create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(layers)
  .png()
  .toBuffer();
const check = process.argv.includes('--check');
async function output(file: string, bytes: Buffer | string) {
  if (check) {
    if (!Buffer.from(bytes).equals(await readAsset(file)))
      throw new Error('Stale ground-panel proof: ' + file);
  } else await writeAsset(file, bytes);
}
await output('staging/ink/ground-panel-proof.png', proof);
await output(
  'staging/ink/ground-panel-proof.json',
  JSON.stringify(
    {
      recipe: 'native-ground-panel-proof-v1',
      frames: frames.map((r, i) => ({
        file: r.file,
        sourceSha256: hash(bytes[i]!),
        canvas: r.canvas,
        density: r.density,
      })),
      runtimeArtwork: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${check ? 'Verified' : 'Prepared'} native ground-panel contact proof outside the runtime payload`,
);
