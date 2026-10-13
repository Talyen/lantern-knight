import sharp from 'sharp';
import contract from '../../../src/assets/camera.json';
import { cameraAxes } from '../../../src/assets/camera-calibration';
import type { PreparationContext } from '../context';
import { effectPreparation } from '../effect-preparation';
export async function prepare(context: PreparationContext, check = false) {
  const { exactSource } = context;
  const { source, frames, write, finish } = effectPreparation(context, check, 'effects-playground');
  const root = 'references/art/ink-collection-01';
  const { right, up, outward } = cameraAxes();
  const emitters: Record<string, number[]> = {};
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
  await finish();
}
